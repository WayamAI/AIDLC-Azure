"""
Sprint Intelligence routes.
Aggregates sprint metrics and generates AI sprint summary + DORA metrics.
"""
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Body

from app.services import github_service, jira_service
from app.services.ai_service import generate_sprint_summary, AIQuotaError


def _parse_github_repo(owner: str, repo: str) -> tuple[str, str]:
    """
    Accept either:
      owner="browser-use", repo="browser-use"
      owner="<anything>", repo="https://github.com/browser-use/browser-use"
    Returns (owner, repo_name).
    """
    if repo.startswith("http://") or repo.startswith("https://"):
        parts = urlparse(repo).path.strip("/").split("/")
        if len(parts) >= 2:
            return parts[0], parts[1]
    return owner, repo

router = APIRouter(prefix="/sprint", tags=["Sprint Intelligence"])


@router.post("/report")
async def generate_sprint_report(body: dict = Body(...)):
    """
    Generate a full sprint intelligence report.

    Body:
      owner: str  (GitHub owner)
      repo: str
      jira_project: str
      sprint_name: str (optional, for display)
    """
    owner = body.get("owner", "")
    repo = body.get("repo", "")
    jira_project = body.get("jira_project", "")
    sprint_name = body.get("sprint_name", "Current Sprint")

    owner, repo = _parse_github_repo(owner, repo)

    report: dict[str, Any] = {
        "sprint_name": sprint_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stories": [],
        "dora": {},
        "quality_metrics": {},
        "errors": [],
    }

    # 1. Jira sprint stories
    stories_with_ac: list[dict] = []
    if jira_project:
        try:
            stories = await jira_service.get_sprint_stories(jira_project, max_results=20)
            report["stories_delivered"] = len(stories)
            report["stories"] = stories

            # Count ambiguous stories (would need stored AC analysis; estimate from description length)
            ambiguous_count = sum(1 for s in stories if len(s.get("description", "")) < 50)
            report["ambiguous_stories_detected"] = ambiguous_count
            report["high_priority_stories"] = sum(
                1 for s in stories if s.get("priority") in ("High", "Highest", "Critical")
            )
        except Exception as exc:
            report["errors"].append(f"Jira: {exc}")
            report["stories_delivered"] = 0

    # 2. GitHub: CI health + DORA proxy
    if owner and repo:
        try:
            runs = await github_service.get_workflow_runs(owner, repo, per_page=50)
            now = datetime.now(timezone.utc)
            last_14_days = [
                r for r in runs
                if (now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).days <= 14
            ]
            total_runs = len(last_14_days)
            failed_runs = sum(1 for r in last_14_days if r["conclusion"] == "failure")
            successful_runs = sum(1 for r in last_14_days if r["conclusion"] == "success")

            deploys_last_7 = sum(
                1 for r in runs
                if r["conclusion"] == "success"
                and (now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).days <= 7
            )

            report["dora"] = {
                "deployment_frequency_per_week": deploys_last_7,
                "change_failure_rate": round(failed_runs / total_runs * 100, 1) if total_runs else 0,
                "total_ci_runs_14d": total_runs,
                "successful_runs_14d": successful_runs,
            }
            report["test_pass_rate"] = round(successful_runs / total_runs * 100, 1) if total_runs else 0
        except Exception as exc:
            report["errors"].append(f"GitHub: {exc}")

    # 3. AI sprint summary
    try:
        summary = await generate_sprint_summary(report)
        report["ai_summary"] = summary
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        report["errors"].append(f"AI summary: {exc}")
        report["ai_summary"] = "AI summary unavailable."

    return report


@router.get("/dora")
async def dora_metrics(owner: str, repo: str):
    """Compute DORA metrics from GitHub Actions data."""
    try:
        runs = await github_service.get_workflow_runs(owner, repo, per_page=100)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    now = datetime.now(timezone.utc)

    def days_ago(r: dict, n: int) -> bool:
        try:
            dt = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
            return (now - dt).days <= n
        except Exception:
            return False

    last_30 = [r for r in runs if days_ago(r, 30)]
    last_7 = [r for r in runs if days_ago(r, 7)]

    total_30 = len(last_30)
    failed_30 = sum(1 for r in last_30 if r["conclusion"] == "failure")
    deploys_per_week = sum(1 for r in last_7 if r["conclusion"] == "success")

    return {
        "deployment_frequency_per_week": deploys_per_week,
        "change_failure_rate_30d": round(failed_30 / total_30 * 100, 1) if total_30 else 0,
        "total_runs_30d": total_30,
        "successful_runs_30d": total_30 - failed_30,
        "failed_runs_30d": failed_30,
    }
