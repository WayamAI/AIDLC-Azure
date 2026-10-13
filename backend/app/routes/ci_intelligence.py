"""
CI/CD Intelligence routes.
- Workflow run health dashboard
- Flaky test detection
- Build failure AI explanations

Workflow runs come from the shared cache and the figures from the shared
functions in app.services.ci_metrics_service, so they match the Sprint, Release
Gate and Pipeline pages. GitHub and AI failures are mapped by app.errors.
"""
from collections import defaultdict

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ci_metrics_service, github_service
from app.services.ai_service import explain_ci_failure

router = APIRouter(prefix="/ci", tags=["CI Intelligence"])


@router.get("/health")
async def build_health(
    owner: str,
    repo: str,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Build health over the most recent workflow runs (ci_metrics_service.HEADLINE_RUNS).

    `success_rate` and `failure_rate` are shares of the evaluated runs (those that
    concluded success or failure) and are null when there are none. Pass
    refresh=true to bypass the few-minute cache; `cache` says how fresh the data is.
    """
    all_runs, cache = await ci_metrics_service.get_workflow_runs(db, org.id, owner, repo, refresh=refresh)

    if not all_runs:
        return {"summary": {}, "runs": [], "failure_categories": {}, "dora": {}, "cache": cache}

    runs = all_runs[:ci_metrics_service.HEADLINE_RUNS]
    summary = ci_metrics_service.headline(all_runs)

    # Build trend by day
    daily: dict[str, dict[str, int]] = defaultdict(lambda: {"success": 0, "failure": 0, "total": 0})
    for r in runs:
        day = str(r.get("created_at") or "")[:10]
        if len(day) != 10:
            continue  # no usable date: left out of the trend rather than dated today
        daily[day]["total"] += 1
        if r["conclusion"] == "success":
            daily[day]["success"] += 1
        elif r["conclusion"] == "failure":
            daily[day]["failure"] += 1

    trend = [{"date": d, **v} for d, v in sorted(daily.items())][-14:]

    # Workflow breakdown
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in runs:
        grouped[r["name"]].append(r)
    by_workflow = []
    for name, wf_runs in grouped.items():
        wf = ci_metrics_service.summarise_runs(wf_runs)
        by_workflow.append({
            "name": name,
            "total": wf["total_runs"],
            "evaluated": wf["evaluated_runs"],
            "success": wf["success_count"],
            "failure": wf["failure_count"],
            # None when no run of this workflow concluded success or failure.
            "failure_rate": wf["failure_rate"],
        })

    return {
        "summary": {
            "total_runs": summary["total_runs"],
            "evaluated_runs": summary["evaluated_runs"],
            "success_count": summary["success_count"],
            "failure_count": summary["failure_count"],
            "cancelled_count": summary["cancelled_count"],
            "success_rate": summary["pass_rate"],
            "failure_rate": summary["failure_rate"],
        },
        "trend": trend,
        "by_workflow": by_workflow,
        # Every run the headline figures were computed from, so a failed run that is
        # counted above can always be found (and explained) in the table.
        "runs": runs,
        "dora": {
            "deployment_frequency_per_week": ci_metrics_service.successful_runs_last_week(all_runs),
            "change_failure_rate": summary["failure_rate"],
        },
        "cache": cache,
    }


@router.get("/flaky-tests")
async def detect_flaky_tests(
    owner: str,
    repo: str,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Detect potentially flaky workflows by looking at repeated failure patterns.
    GitHub doesn't expose per-test results via REST, so this works at workflow
    level: a workflow that both passed and failed among the recent runs.
    """
    all_runs, cache = await ci_metrics_service.get_workflow_runs(db, org.id, owner, repo, refresh=refresh)
    runs = all_runs[:ci_metrics_service.HEADLINE_RUNS]

    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in runs:
        grouped[r["name"]].append(r)

    flaky_candidates = []
    for wf_name, wf_runs in grouped.items():
        wf = ci_metrics_service.summarise_runs(wf_runs)
        if wf["success_count"] and wf["failure_count"] >= 2:
            flaky_candidates.append({
                "workflow": wf_name,
                "total_runs": wf["total_runs"],
                "failures": wf["failure_count"],
                "successes": wf["success_count"],
                "flakiness_score": wf["failure_rate"],
                "verdict": "likely_flaky" if wf["failure_count"] >= 3 else "possibly_flaky",
            })

    flaky_candidates.sort(key=lambda x: x["flakiness_score"], reverse=True)
    return {"flaky_workflows": flaky_candidates, "total": len(flaky_candidates), "cache": cache}


async def explain_workflow_run(owner: str, repo: str, run_id: int) -> dict:
    """AI explanation of a failed run, written from its real logs.

    With no logs to read there is nothing to explain: the answer says so with
    `available: false` and makes no AI call.
    """
    logs = await github_service.get_run_logs_text(owner, repo, run_id)
    if not logs:
        return {
            "available": False,
            "explanation": "No logs are available for this run. It may be too recent, or its logs have expired.",
            "fix": "",
            "category": "unknown",
            "confidence": None,
            "is_flaky_candidate": None,
        }
    languages = await github_service.get_repo_languages(owner, repo)
    primary_lang = max(languages, key=lambda k: languages[k]) if languages else "Unknown"

    error_lines = [
        line for line in logs.splitlines()
        if any(k in line.lower() for k in ("error", "failed", "exception", "assert", "##[error]"))
    ]
    error_message = "\n".join(error_lines[:25])
    step = "CI Workflow"
    for line in logs.splitlines():
        if "##[error]" in line.lower() or "FAILED" in line:
            step = line[:200]
            break

    result = await explain_ci_failure(step, error_message, logs[:2500], primary_lang)
    return {"available": True, **result}


@router.post("/runs/{run_id}/explain")
async def explain_run(owner: str, repo: str, run_id: int, org: OrganizationOut = Depends(get_current_org)):
    """Download CI run logs and generate an AI explanation of the failure."""
    return await explain_workflow_run(owner, repo, run_id)
