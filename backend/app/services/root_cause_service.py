"""
AI Root Cause Analysis evidence collection and persistence.

Reads real failure data out of the existing `playwright_runs` collection
(no new run-tracking is introduced) and correlates it with the repo's real
Git history via app.services.repo_service. Never fabricates evidence: any
field that has no real data stays None/empty and the API/UI show
"Not available" rather than a guess.
"""
import asyncio
import logging
import re
from typing import Any, Optional

from app.models.root_cause import (
    CommitInfo, RootCauseEvidence, StepEvidence, FailureType,
)
from app.services import repo_service

log = logging.getLogger("root_cause_service")

COLLECTION = "root_cause_analyses"

_SELECTOR_RE = re.compile(r"waiting for selector|element.*not found|no element", re.I)
_TIMEOUT_RE = re.compile(r"timeout \d+ms exceeded|timed out", re.I)
_NETWORK_RE = re.compile(r"net::err|econnrefused|network error|failed to fetch", re.I)
_NAV_RE = re.compile(r"navigation failed|err_name_not_resolved|goto.*failed", re.I)
_ASSERTION_RE = re.compile(r"expect\(|assertion|expected .* but (got|received)|tobe\(", re.I)


def classify_failure_type(error: Optional[str]) -> FailureType:
    """Heuristic classification from the real error string no AI call needed for this part."""
    if not error:
        return "unknown"
    if _TIMEOUT_RE.search(error) and _SELECTOR_RE.search(error):
        return "selector_not_found"
    if _SELECTOR_RE.search(error):
        return "selector_not_found"
    if _NETWORK_RE.search(error):
        return "network_error"
    if _NAV_RE.search(error):
        return "navigation_error"
    if _TIMEOUT_RE.search(error):
        return "timeout"
    if _ASSERTION_RE.search(error):
        return "assertion"
    return "script_error"


def build_evidence_sync(test_result: dict[str, Any], repo_doc: Optional[dict]) -> RootCauseEvidence:
    """Pure/sync core so it's cheap to unit test; async wrapper adds Git calls."""
    step_results = test_result.get("step_results", [])
    step_trace = [
        StepEvidence(
            step_number=i + 1,
            step_description=s.get("step_description", ""),
            status=s.get("status", "pass"),
            error=s.get("error"),
        )
        for i, s in enumerate(step_results)
    ]
    failed_steps = [s for s in step_trace if s.status == "fail"]
    failed_step = failed_steps[0] if failed_steps else None
    error_message = failed_step.error if failed_step else test_result.get("error")

    return RootCauseEvidence(
        error_message=error_message,
        failed_step=failed_step,
        step_trace=step_trace,
        console_logs=[],  # not captured by playwright_service today honestly empty, not fabricated
        recent_commits=[],
        has_git_data=False,
        has_stack_trace=bool(step_trace),
        test_type="playwright_e2e",
    )


async def build_evidence(test_result: dict[str, Any], repo_doc: Optional[dict]) -> RootCauseEvidence:
    evidence = build_evidence_sync(test_result, repo_doc)
    if not repo_doc or not repo_doc.get("github_url"):
        return evidence

    github_url = repo_doc["github_url"]
    try:
        commits = await asyncio.to_thread(repo_service.get_repo_commits, github_url, 5)
        evidence.recent_commits = [
            CommitInfo(
                sha=c.get("sha", "")[:12],
                message=(c.get("message") or "").splitlines()[0][:200],
                author=c.get("author", "unknown"),
                date=c.get("date"),
            )
            for c in commits
        ]
        evidence.has_git_data = bool(evidence.recent_commits)
        if evidence.recent_commits:
            diff = await asyncio.to_thread(repo_service.get_commit_diff_content, github_url, commits[0]["sha"])
            evidence.git_diff = (diff.get("diff_text") or "")[:6000]  # cap prompt size
    except Exception as exc:
        log.warning("Root cause: could not fetch git history for %s: %s", github_url, exc)
        # evidence.has_git_data stays False honest, not a fabricated empty success

    return evidence


async def collect_evidence(db, org_id: str, run_id: str, test_id: str) -> tuple[Optional[dict], Optional[dict]]:
    """Returns (run_doc, test_result) or (None, None) if not found."""
    run_doc = await db.playwright_runs.find_one({"_id": run_id, "org_id": org_id})
    if not run_doc:
        return None, None
    test_result = next((r for r in run_doc.get("results", []) if r.get("test_id") == test_id), None)
    return run_doc, test_result


def severity_for(failure_type: FailureType, error: Optional[str]) -> str:
    if failure_type in ("network_error", "navigation_error"):
        return "critical"
    if failure_type in ("selector_not_found", "assertion"):
        return "high"
    if failure_type == "timeout":
        return "medium"
    return "medium"


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index([("org_id", 1), ("created_at", -1)])
        await db[COLLECTION].create_index([("org_id", 1), ("run_id", 1), ("test_id", 1)])
    except Exception as exc:
        log.warning("root_cause index creation failed (non-fatal): %s", exc)


async def save_analysis(db, doc: dict) -> None:
    await db[COLLECTION].replace_one({"_id": doc["_id"], "org_id": doc["org_id"]}, doc, upsert=True)


async def get_analysis(db, org_id: str, analysis_id: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"_id": analysis_id, "org_id": org_id})


async def find_existing_analysis(db, org_id: str, run_id: str, test_id: str) -> Optional[dict]:
    """Look up a prior analysis for this exact (run_id, test_id) so re-analyzing overwrites
    the same document instead of minting a duplicate that inflates failure counts."""
    return await db[COLLECTION].find_one({"org_id": org_id, "run_id": run_id, "test_id": test_id})


async def list_analyses(db, org_id: str, limit: int = 50) -> list[dict]:
    cursor = db[COLLECTION].find({"org_id": org_id}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def compute_summary(db, org_id: str) -> dict:
    docs = await list_analyses(db, org_id, limit=500)
    total = len(docs)
    identified = sum(1 for d in docs if d.get("status") == "completed" and d.get("root_cause_summary"))
    high_conf = sum(1 for d in docs if (d.get("confidence") or 0) >= 90)
    needs_review = sum(1 for d in docs if 0 < (d.get("confidence") or 0) < 70)
    unresolved = sum(1 for d in docs if d.get("status") != "completed")
    return {
        "total_failures": total,
        "root_causes_identified": identified,
        "high_confidence": high_conf,
        "requires_human_review": needs_review,
        "unresolved_failures": unresolved,
    }


async def list_unanalyzed_failures(db, org_id: str, limit: int = 20) -> list[dict]:
    """Scan recent playwright_runs for failed test results with no matching analysis doc."""
    analyzed = await db[COLLECTION].find({"org_id": org_id}, {"run_id": 1, "test_id": 1}).to_list(length=1000)
    analyzed_keys = {(a["run_id"], a["test_id"]) for a in analyzed}

    runs_cursor = db.playwright_runs.find(
        {"org_id": org_id, "failed": {"$gt": 0}}
    ).sort("started_at", -1).limit(30)
    runs = await runs_cursor.to_list(length=30)

    out = []
    for run in runs:
        for result in run.get("results", []):
            if result.get("status") != "failed":
                continue
            key = (run["run_id"], result["test_id"])
            if key in analyzed_keys:
                continue
            out.append({
                "run_id": run["run_id"],
                "test_id": result["test_id"],
                "test_name": result.get("test_name", "Unnamed test"),
                "analysis_id": run.get("analysis_id", ""),
                "error": result.get("error") or (
                    next((s.get("error") for s in result.get("step_results", []) if s.get("status") == "fail"), None)
                ),
                "completed_at": run.get("completed_at"),
            })
            if len(out) >= limit:
                return out
    return out
