"""
Async analysis runner.

Runs the full pipeline (clone → extract → LLM analysis → test generation → save)
in a FastAPI background task and stores real-time progress so the frontend can poll.

Job states:  pending → cloning → extracting → analyzing → generating → completed | failed

Every test and analysis a job returns came from the AI call. If that call fails,
times out or returns nothing usable, the job ends `failed` with the reason; no
template content is substituted.

Job state lives in MongoDB (`repo_analysis_jobs`); `_jobs` is the write-through
cache of jobs this process is running (see app.services.durable_state).
"""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import durable_state, repo_service
from app.services.ai_service import (
    AIQuotaError,
    analyze_codebase,
    analyze_commit_and_generate_tests,
    generate_playwright_tests,
    set_current_org_id,
)

JOBS = "repo_analysis_jobs"

# Jobs owned by this process: job_id → live state.
_jobs: dict[str, dict[str, Any]] = {}
# Test passwords for those jobs. Held in memory only, never written to MongoDB
# and never returned by the polling endpoint.
_secrets: dict[str, str | None] = {}

_GENERATE_TIMEOUT_S = 90.0
_ANALYZE_TIMEOUT_S = 180.0

_STORED_ONLY = ("_id", "heartbeat_at")


class AnalysisStepError(RuntimeError):
    """A pipeline step failed; the message is what the job reports as its error."""


async def _ai_step(what: str, coro, timeout: float):
    """Run one AI call for the job, turning each failure into a stated reason."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise AnalysisStepError(f"{what} timed out after {timeout:.0f}s. Please try again.") from exc
    except AIQuotaError as exc:
        raise AnalysisStepError(f"{what} stopped: AI provider quota reached. {exc}") from exc
    except Exception as exc:
        raise AnalysisStepError(f"{what} failed: {str(exc) or type(exc).__name__}") from exc


async def _analyze(codebase_content: str, target_url: str) -> dict[str, Any]:
    analysis = await _ai_step(
        "AI codebase analysis", analyze_codebase(codebase_content, target_url), _ANALYZE_TIMEOUT_S
    )
    if not isinstance(analysis, dict) or not (
        analysis.get("pages") or analysis.get("user_flows") or analysis.get("summary")
    ):
        raise AnalysisStepError("AI codebase analysis failed: the model returned no pages, flows or summary.")
    return analysis


def _usable_tests(tests: Any, what: str) -> list[dict[str, Any]]:
    usable = [t for t in tests if isinstance(t, dict) and t.get("steps")] if isinstance(tests, list) else []
    if not usable:
        raise AnalysisStepError(f"{what} failed: the model returned no test with executable steps.")
    return usable


async def _generate_tests(
    analysis_data: dict[str, Any],
    target_url: str,
    test_email: str | None,
    test_password: str | None,
    test_preferences: str | None,
    num_tests: int,
) -> list[dict[str, Any]]:
    tests = await _ai_step(
        "AI test generation",
        generate_playwright_tests(
            analysis_data,
            target_url,
            test_email=test_email,
            test_password=test_password,
            test_preferences=test_preferences,
            num_tests=num_tests,
        ),
        _GENERATE_TIMEOUT_S,
    )
    return _usable_tests(tests, "AI test generation")


# ── Job store ────────────────────────────────────────────────────────────────

def _stored(job: dict[str, Any]) -> dict[str, Any]:
    return {**job, "_id": job["job_id"], "logs": list(job["logs"]), "heartbeat_at": durable_state.now()}


async def _write(db, job: dict[str, Any]) -> None:
    await db[JOBS].replace_one({"_id": job["job_id"]}, _stored(job), upsert=True)


async def create_job(
    db,
    org_id: str,
    github_url: str,
    target_url: str,
    test_email: str | None = None,
    test_password: str | None = None,
    test_preferences: str | None = None,
    num_tests: int = 1,
    mode: str = "full",
    commit_sha: str | None = None,
    commit_message: str | None = None,
) -> str:
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "org_id": org_id,
        "status": "pending",
        "step": "pending",
        "logs": [],
        "github_url": github_url,
        "target_url": target_url,
        "test_email": test_email,
        "test_preferences": test_preferences,
        "num_tests": max(1, min(num_tests, 10)),  # clamp 1–10
        "mode": mode,                      # "full" | "commit"
        "commit_sha": commit_sha,
        "commit_message": commit_message,
        "result": None,
        "error": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
    }
    await _write(db, job)
    _jobs[job_id] = job
    _secrets[job_id] = test_password
    return job_id


async def get_job(db, job_id: str, org_id: str) -> dict[str, Any] | None:
    """The job's current state, for its own org only.

    A job running in this process is answered from memory. Otherwise the stored
    record is returned; if it still says pending/running but its owner stopped
    writing, it is marked failed as interrupted and returned that way.
    """
    job = _jobs.get(job_id)
    if job is not None:
        return job if job.get("org_id") == org_id else None

    doc = await db[JOBS].find_one({"_id": job_id, "org_id": org_id})
    if doc is None:
        return None
    if durable_state.is_orphaned(doc):
        fields = {
            "status": "failed",
            "step": "failed",
            "error": durable_state.INTERRUPTED_ERROR,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        await db[JOBS].update_one({"_id": job_id, "status": doc["status"]}, {"$set": fields})
        doc.update(fields)
    for key in _STORED_ONLY:
        doc.pop(key, None)
    return doc


async def ensure_indexes(db) -> None:
    await db[JOBS].create_index([("org_id", 1), ("started_at", -1)])


async def _run_job(db, job_id: str, pipeline) -> None:
    """Run `pipeline(job, log)` with the job's state persisted for its whole lifetime."""
    job = _jobs[job_id]
    # This task runs detached from the request that queued it (via
    # BackgroundTasks), so any inherited org-context contextvar is not
    # guaranteed to still be set attribute AI calls made in this task
    # explicitly rather than relying on it.
    set_current_org_id(job["org_id"])

    def log(msg: str) -> None:
        job["logs"].append(msg)
        print(f"[Job {job_id[:8]}] {msg}")

    stop = asyncio.Event()
    flusher = asyncio.create_task(
        durable_state.keep_flushed(
            lambda: _write(db, job),
            lambda: (job["status"], job["step"], len(job["logs"])),
            stop,
        )
    )
    try:
        job["status"] = "running"
        job["result"] = await pipeline(db, job, log)
        job["status"] = "completed"
        job["step"] = "completed"
    except BaseException as exc:
        cancelled = isinstance(exc, asyncio.CancelledError)
        job["status"] = "failed"
        job["step"] = "failed"
        job["error"] = durable_state.INTERRUPTED_ERROR if cancelled else str(exc)
        log(f"✗ Error: {job['error']}")
        if cancelled:
            raise
    finally:
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        stop.set()
        persisted = await asyncio.shield(flusher)
        _secrets.pop(job_id, None)
        if persisted:
            # MongoDB now answers for this job; without a stored copy it stays readable here.
            _jobs.pop(job_id, None)


async def _save_analysis(db, analysis_doc: dict[str, Any], tests_raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert the analysis and its tests; return the tests in API shape."""
    test_docs = [
        {"_id": str(uuid.uuid4()), "org_id": analysis_doc["org_id"], "analysis_id": analysis_doc["_id"], **t}
        for t in tests_raw
    ]
    try:
        await db.repo_analyses.insert_one(analysis_doc)
        await db.playwright_tests.insert_many(test_docs)
    except Exception as exc:
        raise RuntimeError(
            "Tests were generated but could not be saved. "
            "Start MongoDB (docker start aidlc-mongo) and try again. "
            f"Details: {exc}"
        ) from exc
    return [{**d, "id": d.pop("_id")} for d in test_docs]


# ── Full analysis ────────────────────────────────────────────────────────────

async def _full_pipeline(db, job: dict[str, Any], log) -> dict[str, Any]:
    org_id: str = job["org_id"]
    test_email: str | None = job.get("test_email")
    num_tests: int = job.get("num_tests", 1)

    # ── Step 1: Clone ─────────────────────────────────────────────────────
    job["step"] = "cloning"
    log("Step 1/4: Cloning repository...")
    try:
        repo_path = await _run_blocking(repo_service.clone_repo, job["github_url"])
    except Exception as exc:
        raise RuntimeError(f"Git clone failed: {exc}") from exc
    log("  ✓ Repository cloned successfully")

    # ── Step 2: Extract files ─────────────────────────────────────────────
    job["step"] = "extracting"
    log("Step 2/4: Extracting source files...")
    try:
        codebase_content = await _run_blocking(repo_service.extract_codebase, repo_path)
    finally:
        repo_service.cleanup_repo(repo_path)
    log(f"  ✓ Extracted {len(codebase_content):,} characters across source files")

    # ── Step 3: LLM codebase analysis ─────────────────────────────────────
    job["step"] = "analyzing"
    log("Step 3/4: AI is reading and analysing the codebase...")
    analysis_data = await _analyze(codebase_content, job["target_url"])
    log(f"  ✓ Identified {len(analysis_data.get('pages') or [])} pages and "
        f"{len(analysis_data.get('user_flows') or [])} user flows")
    log(f"  ✓ Tech stack: {analysis_data.get('tech_stack', 'unknown')}")
    log(f"  ✓ Summary: {str(analysis_data.get('summary') or '')[:120]}...")

    # ── Step 4: Generate Playwright tests ─────────────────────────────────
    job["step"] = "generating"
    if test_email:
        log(f"  ℹ Using provided credentials ({test_email}) in test generation")
    log(f"Step 4/4: Generating {num_tests} Playwright test case(s)...")
    tests_raw = await _generate_tests(
        analysis_data,
        job["target_url"],
        test_email,
        _secrets.get(job["job_id"]),
        job.get("test_preferences"),
        num_tests,
    )
    log(f"  ✓ Generated {len(tests_raw)} test cases")

    # ── Persist to MongoDB ────────────────────────────────────────────────
    analysis_id = str(uuid.uuid4())
    response_tests = await _save_analysis(db, {
        "_id": analysis_id,
        "org_id": org_id,
        "github_url": job["github_url"],
        "target_url": job["target_url"],
        "test_email": test_email,
        "created_at": datetime.now(timezone.utc),
        **analysis_data,
    }, tests_raw)

    log(f"✓ Analysis complete ready to run {len(response_tests)} tests live!")
    return {
        "analysis_id": analysis_id,
        "target_url": job["target_url"],
        "summary": analysis_data.get("summary", ""),
        "tech_stack": analysis_data.get("tech_stack", ""),
        "pages": analysis_data.get("pages", []),
        "user_flows": analysis_data.get("user_flows", []),
        "tests": response_tests,
        "tests_source": "ai",
    }


async def run_analysis(db, job_id: str) -> None:
    """Background task: runs the full analysis pipeline, keeping the job's state current."""
    await _run_job(db, job_id, _full_pipeline)


# ── Commit analysis ──────────────────────────────────────────────────────────

async def _commit_pipeline(db, job: dict[str, Any], log) -> dict[str, Any]:
    """Steps: cloning → extracting (diff) → analyzing → generating."""
    org_id: str = job["org_id"]
    commit_sha: str = job.get("commit_sha") or ""
    commit_message: str = job.get("commit_message") or ""
    test_email: str | None = job.get("test_email")
    num_tests: int = job.get("num_tests", 1)

    # ── Step 1: Clone + extract diff ──────────────────────────────────────
    job["step"] = "cloning"
    log("Step 1/4: Cloning repository and reading commit diff...")
    try:
        diff_data = await _run_blocking(
            repo_service.get_commit_diff_content, job["github_url"], commit_sha
        )
    except Exception as exc:
        raise RuntimeError(f"Git clone/diff failed: {exc}") from exc

    changed_files: list[str] = diff_data["changed_files"]
    short_files = ", ".join(changed_files[:5])
    if len(changed_files) > 5:
        short_files += f" … +{len(changed_files) - 5} more"
    log("  ✓ Repository cloned")
    log(f"  ✓ {len(changed_files)} files changed: {short_files}")

    # ── Step 2: Diff extracted ────────────────────────────────────────────
    job["step"] = "extracting"
    log("Step 2/4: Extracting diff and changed file contents...")
    log(f"  ✓ Diff size: {len(diff_data['diff_text']):,} chars")
    log(f"  ✓ File contents: {len(diff_data['file_contents']):,} chars")

    # ── Step 3: LLM analysis + test generation (combined call) ────────────
    job["step"] = "analyzing"
    log("Step 3/4: AI analysing commit changes...")
    answer = await _ai_step(
        "AI commit analysis",
        analyze_commit_and_generate_tests(
            commit_sha=commit_sha,
            commit_message=commit_message,
            diff_text=diff_data["diff_text"],
            file_contents=diff_data["file_contents"],
            changed_files=changed_files,
            target_url=job["target_url"],
            test_email=test_email,
            test_password=_secrets.get(job["job_id"]),
            num_tests=num_tests,
        ),
        _GENERATE_TIMEOUT_S,
    )
    analysis_data, tests_raw = answer
    if not isinstance(analysis_data, dict):
        analysis_data = {}
    tests_raw = _usable_tests(tests_raw, "AI commit analysis")

    log(f"  ✓ Identified {len(analysis_data.get('pages') or [])} affected pages and "
        f"{len(analysis_data.get('user_flows') or [])} user flows")
    log(f"  ✓ Tech stack: {analysis_data.get('tech_stack', 'unknown')}")
    log(f"  ✓ Summary: {str(analysis_data.get('summary') or '')[:120]}...")

    # ── Step 4: Persist tests ─────────────────────────────────────────────
    job["step"] = "generating"
    log("Step 4/4: Saving targeted test cases...")
    log(f"  ✓ Generated {len(tests_raw)} targeted test cases for this commit")

    analysis_id = str(uuid.uuid4())
    response_tests = await _save_analysis(db, {
        "_id": analysis_id,
        "org_id": org_id,
        "github_url": job["github_url"],
        "target_url": job["target_url"],
        "test_email": test_email,
        "mode": "commit",
        "commit_sha": commit_sha,
        "commit_message": commit_message,
        "changed_files": changed_files,
        "created_at": datetime.now(timezone.utc),
        **analysis_data,
    }, tests_raw)

    log(f"✓ Analysis complete ready to run {len(response_tests)} targeted tests live!")
    return {
        "analysis_id": analysis_id,
        "target_url": job["target_url"],
        "summary": analysis_data.get("summary", ""),
        "tech_stack": analysis_data.get("tech_stack", ""),
        "pages": analysis_data.get("pages", []),
        "user_flows": analysis_data.get("user_flows", []),
        "tests": response_tests,
        "mode": "commit",
        "commit_sha": commit_sha,
        "commit_message": commit_message,
        "changed_files": changed_files,
        "tests_source": "ai",
    }


async def run_commit_analysis(db, job_id: str) -> None:
    """Background task: runs the commit-specific analysis pipeline."""
    await _run_job(db, job_id, _commit_pipeline)


async def _run_blocking(fn, *args):
    return await asyncio.to_thread(fn, *args)
