"""
CI/CD Intelligence routes.
- Workflow run health dashboard
- Flaky test detection
- Build failure AI explanations
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from app.services import github_service
from app.services.ai_service import explain_ci_failure, AIQuotaError

router = APIRouter(prefix="/ci", tags=["CI Intelligence"])


def _parse_dt(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


@router.get("/health")
async def build_health(owner: str, repo: str):
    """Compute build health metrics from the last 30 workflow runs."""
    try:
        runs = await github_service.get_workflow_runs(owner, repo, per_page=50)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not runs:
        return {"summary": {}, "runs": [], "failure_categories": {}, "dora": {}}

    total = len(runs)
    successful = sum(1 for r in runs if r["conclusion"] == "success")
    failed = sum(1 for r in runs if r["conclusion"] == "failure")
    cancelled = sum(1 for r in runs if r["conclusion"] == "cancelled")

    # Build trend last 7 days by day
    daily: dict[str, dict[str, int]] = defaultdict(lambda: {"success": 0, "failure": 0, "total": 0})
    for r in runs:
        day = _parse_dt(r["created_at"]).strftime("%Y-%m-%d")
        daily[day]["total"] += 1
        if r["conclusion"] == "success":
            daily[day]["success"] += 1
        elif r["conclusion"] == "failure":
            daily[day]["failure"] += 1

    trend = [{"date": d, **v} for d, v in sorted(daily.items())][-14:]

    # Workflow breakdown
    by_workflow: dict[str, dict] = defaultdict(lambda: {"name": "", "total": 0, "success": 0, "failure": 0})
    for r in runs:
        wf = r["name"]
        by_workflow[wf]["name"] = wf
        by_workflow[wf]["total"] += 1
        if r["conclusion"] == "success":
            by_workflow[wf]["success"] += 1
        elif r["conclusion"] == "failure":
            by_workflow[wf]["failure"] += 1
    for v in by_workflow.values():
        v["failure_rate"] = round(v["failure"] / v["total"] * 100, 1) if v["total"] else 0

    # DORA: deployment frequency (successful deploys per week)
    now = datetime.now(timezone.utc)
    deploys_last_week = sum(
        1 for r in runs
        if r["conclusion"] == "success"
        and (now - _parse_dt(r["created_at"])).days <= 7
    )

    return {
        "summary": {
            "total_runs": total,
            "success_count": successful,
            "failure_count": failed,
            "cancelled_count": cancelled,
            "success_rate": round(successful / total * 100, 1) if total else 0,
            "failure_rate": round(failed / total * 100, 1) if total else 0,
        },
        "trend": trend,
        "by_workflow": list(by_workflow.values()),
        "runs": runs[:20],
        "dora": {
            "deployment_frequency_per_week": deploys_last_week,
            "change_failure_rate": round(failed / total * 100, 1) if total else 0,
        },
    }


@router.get("/flaky-tests")
async def detect_flaky_tests(owner: str, repo: str):
    """
    Detect potentially flaky tests by looking at repeated failure patterns.
    Since GitHub doesn't expose per-test results via REST, we use workflow name
    patterns and branch-based analysis as a proxy.
    """
    try:
        runs = await github_service.get_workflow_runs(owner, repo, per_page=50)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Identify workflows that appear in both success and failure within a 14-day window
    workflow_outcomes: dict[str, list[str]] = defaultdict(list)
    for r in runs:
        workflow_outcomes[r["name"]].append(r["conclusion"] or "unknown")

    flaky_candidates = []
    for wf_name, outcomes in workflow_outcomes.items():
        has_success = "success" in outcomes
        has_failure = "failure" in outcomes
        failure_count = outcomes.count("failure")
        success_count = outcomes.count("success")
        if has_success and has_failure and failure_count >= 2:
            total = len(outcomes)
            flaky_candidates.append({
                "workflow": wf_name,
                "total_runs": total,
                "failures": failure_count,
                "successes": success_count,
                "flakiness_score": round(failure_count / total * 100, 1),
                "verdict": "likely_flaky" if failure_count >= 3 else "possibly_flaky",
            })

    flaky_candidates.sort(key=lambda x: x["flakiness_score"], reverse=True)
    return {"flaky_workflows": flaky_candidates, "total": len(flaky_candidates)}


@router.post("/runs/{run_id}/explain")
async def explain_run(owner: str, repo: str, run_id: int):
    """Download CI run logs and generate an AI explanation of the failure."""
    try:
        logs = await github_service.get_run_logs_text(owner, repo, run_id)
        if not logs:
            return {
                "explanation": "No logs available. The run may have been too recent or logs expired.",
                "fix": "Check the GitHub Actions run directly for details.",
                "category": "unknown",
                "confidence": 0.0,
                "is_flaky_candidate": False,
            }
        languages = await github_service.get_repo_languages(owner, repo)
        primary_lang = max(languages, key=lambda k: languages[k]) if languages else "Unknown"

        error_lines = [
            l for l in logs.splitlines()
            if any(k in l.lower() for k in ("error", "failed", "exception", "assert", "##[error]"))
        ]
        error_message = "\n".join(error_lines[:25])
        step = "CI Workflow"
        for line in logs.splitlines():
            if "##[error]" in line.lower() or "FAILED" in line:
                step = line[:200]
                break

        result = await explain_ci_failure(step, error_message, logs[:2500], primary_lang)
        return result
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
