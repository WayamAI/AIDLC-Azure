"""
Async analysis runner.

Runs the full pipeline (clone → extract → LLM analysis → test generation → save)
in a FastAPI background task and stores real-time progress so the frontend can poll.

Job states:  pending → cloning → extracting → analyzing → generating → completed | failed
"""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import repo_service
from app.services.ai_service import (
    AIQuotaError,
    analyze_codebase,
    analyze_commit_and_generate_tests,
    generate_playwright_tests,
    set_current_org_id,
)

# ── In-memory job store ───────────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}

_GENERATE_TIMEOUT_S = 90.0
_ANALYZE_TIMEOUT_S = 180.0


def fallback_playwright_tests(
    analysis: dict[str, Any],
    target_url: str,
    num_tests: int = 1,
) -> list[dict[str, Any]]:
    """Deterministic tests from analysis pages/flows so Live Tests can proceed without LLM."""
    pages = analysis.get("pages") or []
    flows = analysis.get("user_flows") or []
    sources: list[dict[str, Any]] = []
    for page in pages:
        if isinstance(page, dict):
            sources.append(page)
    if not sources:
        for flow in flows:
            if isinstance(flow, dict):
                sources.append({"name": flow.get("name") or "Flow", "path": "/", "description": flow.get("name")})
    if not sources:
        sources = [{"name": "Home", "path": "/", "description": "Open the application"}]

    n = max(1, min(int(num_tests or 1), 3, len(sources)))
    base = (target_url or "").rstrip("/")
    tests: list[dict[str, Any]] = []
    for i, page in enumerate(sources[:n]):
        name = str(page.get("name") or f"Page {i + 1}")
        path = str(page.get("path") or "/")
        url = base if path in {"", "/"} else f"{base}{path if path.startswith('/') else '/' + path}"
        tests.append({
            "name": f"Open {name}",
            "description": page.get("description") or f"Load {name} and capture a screenshot",
            "page_name": name,
            "severity": "High" if i == 0 else "Medium",
            "steps": [
                {"action": "navigate", "selector": None, "value": url, "description": f"Navigate to {name}"},
                {"action": "screenshot", "selector": None, "value": None, "description": "Capture page load"},
                {"action": "assert_text", "selector": None, "value": name, "description": f"Look for {name}"},
            ],
        })
    return tests


async def _generate_tests_or_fallback(
    *,
    analysis_data: dict[str, Any],
    target_url: str,
    test_email: str | None,
    test_password: str | None,
    test_preferences: str | None,
    num_tests: int,
    log,
) -> tuple[list[dict[str, Any]], str]:
    try:
        tests_raw = await asyncio.wait_for(
            generate_playwright_tests(
                analysis_data,
                target_url,
                test_email=test_email,
                test_password=test_password,
                test_preferences=test_preferences,
                num_tests=num_tests,
            ),
            timeout=_GENERATE_TIMEOUT_S,
        )
        if tests_raw:
            return tests_raw, "ai"
        log("  ⚠ AI returned no tests; using template tests")
    except asyncio.TimeoutError:
        log(f"  ⚠ AI test generation timed out after {_GENERATE_TIMEOUT_S:.0f}s; using template tests")
    except AIQuotaError as exc:
        log(f"  ⚠ AI quota during test generation: {exc}; using template tests")
    except Exception as exc:
        log(f"  ⚠ AI test generation failed: {exc}; using template tests")
    return fallback_playwright_tests(analysis_data, target_url, num_tests), "fallback"


def fallback_analysis(target_url: str, reason: str = "") -> dict[str, Any]:
    """Minimal analysis so Live Tests can still generate template coverage."""
    return {
        "summary": reason or "AI analysis was unavailable; using template coverage.",
        "tech_stack": "unknown",
        "pages": [{"name": "Home", "path": "/", "description": "Application home"}],
        "user_flows": [{"name": "Open app", "steps": [f"Navigate to {target_url or '/'}"]}],
    }


async def _analyze_or_fallback(
    *,
    codebase_content: str,
    target_url: str,
    log,
) -> tuple[dict[str, Any], str]:
    try:
        analysis_data = await asyncio.wait_for(
            analyze_codebase(codebase_content, target_url),
            timeout=_ANALYZE_TIMEOUT_S,
        )
        if isinstance(analysis_data, dict) and (
            analysis_data.get("pages")
            or analysis_data.get("user_flows")
            or analysis_data.get("summary")
        ):
            return analysis_data, "ai"
        log("  ⚠ AI analysis returned no structure; using a minimal analysis")
    except asyncio.TimeoutError:
        log(f"  ⚠ AI analysis timed out after {_ANALYZE_TIMEOUT_S:.0f}s; using a minimal analysis")
    except AIQuotaError as exc:
        log(f"  ⚠ AI quota during analysis: {exc}; using a minimal analysis")
    except Exception as exc:
        log(f"  ⚠ AI analysis failed: {exc}; using a minimal analysis")
    return fallback_analysis(target_url), "fallback"


def create_job(
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
    _jobs[job_id] = {
        "job_id": job_id,
        "org_id": org_id,
        "status": "pending",
        "step": "pending",
        "logs": [],
        "github_url": github_url,
        "target_url": target_url,
        "test_email": test_email,
        "test_password": test_password,
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
    return job_id


def get_job(job_id: str, org_id: str) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    if job is None:
        return None
    if job.get("org_id") != org_id:
        return None
    return job


async def run_analysis(db, job_id: str) -> None:
    """
    Background task: runs the full analysis pipeline and updates the job dict in-place.
    """
    job = _jobs[job_id]
    org_id: str = job["org_id"]
    # This task runs detached from the request that queued it (via
    # BackgroundTasks), so any inherited org-context contextvar is not
    # guaranteed to still be set attribute AI calls made in this task
    # explicitly rather than relying on it.
    set_current_org_id(org_id)
    test_email: str | None = job.get("test_email")
    test_password: str | None = job.get("test_password")
    test_preferences: str | None = job.get("test_preferences")
    num_tests: int = job.get("num_tests", 1)

    def log(msg: str) -> None:
        job["logs"].append(msg)
        print(f"[Job {job_id[:8]}] {msg}")

    repo_path: str | None = None

    try:
        # ── Step 1: Clone ─────────────────────────────────────────────────────
        job["status"] = "running"
        job["step"] = "cloning"
        log("Step 1/4: Cloning repository...")
        try:
            repo_path = await _run_blocking(repo_service.clone_repo, job["github_url"])
            log("  ✓ Repository cloned successfully")
        except Exception as exc:
            raise RuntimeError(f"Git clone failed: {exc}") from exc

        # ── Step 2: Extract files ─────────────────────────────────────────────
        job["step"] = "extracting"
        log("Step 2/4: Extracting source files...")
        try:
            codebase_content = await _run_blocking(repo_service.extract_codebase, repo_path)
            log(f"  ✓ Extracted {len(codebase_content):,} characters across source files")
        finally:
            if repo_path:
                repo_service.cleanup_repo(repo_path)
                repo_path = None

        # ── Step 3: LLM codebase analysis ─────────────────────────────────────
        job["step"] = "analyzing"
        log("Step 3/4: AI is reading and analysing the codebase...")
        analysis_data, analysis_source = await _analyze_or_fallback(
            codebase_content=codebase_content,
            target_url=job["target_url"],
            log=log,
        )
        if analysis_source != "ai":
            log("  ⚠ Continuing with template analysis so test generation can proceed")

        pages_found = len(analysis_data.get("pages", []))
        flows_found = len(analysis_data.get("user_flows", []))
        log(f"  ✓ Identified {pages_found} pages and {flows_found} user flows")
        log(f"  ✓ Tech stack: {analysis_data.get('tech_stack', 'unknown')}")
        log(f"  ✓ Summary: {analysis_data.get('summary', '')[:120]}...")

        # ── Step 4: Generate Playwright tests ─────────────────────────────────
        job["step"] = "generating"
        if test_email:
            log(f"  ℹ Using provided credentials ({test_email}) in test generation")
        log(f"Step 4/4: Generating {num_tests} Playwright test case(s)...")
        tests_raw, tests_source = await _generate_tests_or_fallback(
            analysis_data=analysis_data,
            target_url=job["target_url"],
            test_email=test_email,
            test_password=test_password,
            test_preferences=test_preferences,
            num_tests=num_tests,
            log=log,
        )
        log(f"  ✓ Generated {len(tests_raw)} test cases ({tests_source})")

        # ── Persist to MongoDB ────────────────────────────────────────────────
        analysis_id = str(uuid.uuid4())

        analysis_doc = {
            "_id": analysis_id,
            "org_id": org_id,
            "github_url": job["github_url"],
            "target_url": job["target_url"],
            "test_email": test_email,
            # Never store the password in plain text in a real app acceptable here
            "created_at": datetime.now(timezone.utc),
            **analysis_data,
        }
        try:
            await db.repo_analyses.insert_one(analysis_doc)

            test_docs: list[dict] = []
            for t in tests_raw:
                test_docs.append({"_id": str(uuid.uuid4()), "org_id": org_id, "analysis_id": analysis_id, **t})
            if test_docs:
                await db.playwright_tests.insert_many(test_docs)
        except Exception as exc:
            raise RuntimeError(
                "Tests were generated but could not be saved. "
                "Start MongoDB (docker start aidlc-mongo) and try again. "
                f"Details: {exc}"
            ) from exc

        response_tests = [{**d, "id": d.pop("_id")} for d in test_docs]

        # ── Done ──────────────────────────────────────────────────────────────
        job["status"] = "completed"
        job["step"] = "completed"
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["result"] = {
            "analysis_id": analysis_id,
            "target_url": job["target_url"],
            "summary": analysis_data.get("summary", ""),
            "tech_stack": analysis_data.get("tech_stack", ""),
            "pages": analysis_data.get("pages", []),
            "user_flows": analysis_data.get("user_flows", []),
            "tests": response_tests,
            "tests_source": tests_source,
        }
        log(f"✓ Analysis complete ready to run {len(test_docs)} tests live!")

    except Exception as exc:
        if repo_path:
            repo_service.cleanup_repo(repo_path)
        job["status"] = "failed"
        job["step"] = "failed"
        job["error"] = str(exc)
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        log(f"✗ Error: {exc}")


async def run_commit_analysis(db, job_id: str) -> None:
    """
    Background task: runs commit-specific analysis pipeline.
    Steps: cloning → extracting (diff) → analyzing → generating → completed
    """
    job = _jobs[job_id]
    org_id: str = job["org_id"]
    set_current_org_id(org_id)
    commit_sha: str = job.get("commit_sha", "")
    commit_message: str = job.get("commit_message", "")
    test_email: str | None = job.get("test_email")
    test_password: str | None = job.get("test_password")
    num_tests: int = job.get("num_tests", 1)

    def log(msg: str) -> None:
        job["logs"].append(msg)
        print(f"[Job {job_id[:8]}] {msg}")

    try:
        job["status"] = "running"

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
        log(f"  ✓ Repository cloned")
        log(f"  ✓ {len(changed_files)} files changed: {short_files}")

        # ── Step 2: Diff extracted ────────────────────────────────────────────
        job["step"] = "extracting"
        log("Step 2/4: Extracting diff and changed file contents...")
        log(f"  ✓ Diff size: {len(diff_data['diff_text']):,} chars")
        log(f"  ✓ File contents: {len(diff_data['file_contents']):,} chars")

        # ── Step 3: LLM analysis + test generation (combined call) ────────────
        job["step"] = "analyzing"
        log("Step 3/4: AI analysing commit changes...")
        analysis_data: dict[str, Any] = {}
        tests_raw: list[dict[str, Any]] = []
        tests_source = "ai"
        try:
            analysis_data, tests_raw = await asyncio.wait_for(
                analyze_commit_and_generate_tests(
                    commit_sha=commit_sha,
                    commit_message=commit_message,
                    diff_text=diff_data["diff_text"],
                    file_contents=diff_data["file_contents"],
                    changed_files=changed_files,
                    target_url=job["target_url"],
                    test_email=test_email,
                    test_password=test_password,
                    num_tests=num_tests,
                ),
                timeout=_GENERATE_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            log(f"  ⚠ Commit AI timed out after {_GENERATE_TIMEOUT_S:.0f}s; using template tests")
            tests_source = "fallback"
            analysis_data = {
                "summary": commit_message or "Commit analysis timed out",
                "tech_stack": "unknown",
                "pages": [],
                "user_flows": [],
            }
            tests_raw = fallback_playwright_tests(analysis_data, job["target_url"], num_tests)
        except AIQuotaError as exc:
            log(f"  ⚠ AI quota: {exc}; using template tests")
            tests_source = "fallback"
            analysis_data = {
                "summary": commit_message or "Commit analysis skipped (AI quota)",
                "tech_stack": "unknown",
                "pages": [],
                "user_flows": [],
            }
            tests_raw = fallback_playwright_tests(analysis_data, job["target_url"], num_tests)
        if not tests_raw:
            tests_raw = fallback_playwright_tests(analysis_data, job["target_url"], num_tests)
            tests_source = "fallback"

        pages_found = len(analysis_data.get("pages", []))
        flows_found = len(analysis_data.get("user_flows", []))
        log(f"  ✓ Identified {pages_found} affected pages and {flows_found} user flows")
        log(f"  ✓ Tech stack: {analysis_data.get('tech_stack', 'unknown')}")
        summary_preview = analysis_data.get("summary", "")[:120]
        log(f"  ✓ Summary: {summary_preview}...")

        # ── Step 4: Persist tests ─────────────────────────────────────────────
        job["step"] = "generating"
        log(f"Step 4/4: Saving targeted test cases...")
        log(f"  ✓ Generated {len(tests_raw)} targeted test cases for this commit")

        analysis_id = str(uuid.uuid4())

        analysis_doc = {
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
        }
        await db.repo_analyses.insert_one(analysis_doc)

        test_docs: list[dict] = [
            {"_id": str(uuid.uuid4()), "org_id": org_id, "analysis_id": analysis_id, **t}
            for t in tests_raw
        ]
        if test_docs:
            await db.playwright_tests.insert_many(test_docs)

        response_tests = [{**d, "id": d.pop("_id")} for d in test_docs]

        job["status"] = "completed"
        job["step"] = "completed"
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["result"] = {
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
            "tests_source": tests_source,
        }
        log(f"✓ Analysis complete ready to run {len(test_docs)} targeted tests live!")

    except Exception as exc:
        job["status"] = "failed"
        job["step"] = "failed"
        job["error"] = str(exc)
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        log(f"✗ Error: {exc}")


async def _run_blocking(fn, *args):
    return await asyncio.to_thread(fn, *args)
