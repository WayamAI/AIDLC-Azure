"""
Sprint Intelligence routes.
Aggregates sprint metrics and generates AI sprint summary + DORA metrics.
"""
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ci_metrics_service, github_service, jira_service
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
async def generate_sprint_report(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Generate a full sprint intelligence report.

    Body:
      owner: str  (GitHub owner)
      repo: str
      jira_project: str
      sprint_name: str (optional, for display)
      refresh: bool (optional, bypass the GitHub cache)

    A figure whose source could not be read is null and the reason is in
    `errors`. `ai_summary` is null when the AI call failed.
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

            # A length rule, not an AI judgement: stories with a description under 50 characters.
            ambiguous_count = sum(1 for s in stories if len(s.get("description", "")) < 50)
            report["ambiguous_stories_detected"] = ambiguous_count
            report["ambiguous_stories_rule"] = "description shorter than 50 characters"
            report["high_priority_stories"] = sum(
                1 for s in stories if s.get("priority") in ("High", "Highest", "Critical")
            )
        except Exception as exc:
            report["errors"].append(f"Jira: {exc}")
            report["stories_delivered"] = None

    # 2. GitHub: CI health + DORA proxy
    cache = None
    if owner and repo:
        try:
            runs, cache = await ci_metrics_service.get_workflow_runs(
                db, org.id, owner, repo, refresh=bool(body.get("refresh"))
            )
            # Headline figures are the same ones CI Intelligence and the release gate show.
            summary = ci_metrics_service.headline(runs)
            last_14_days = ci_metrics_service.summarise_runs(ci_metrics_service.runs_within(runs, 14))

            report["dora"] = {
                "deployment_frequency_per_week": ci_metrics_service.successful_runs_last_week(runs),
                "change_failure_rate": summary["failure_rate"],
                "total_ci_runs_14d": last_14_days["total_runs"],
                "successful_runs_14d": last_14_days["success_count"],
            }
            report["test_pass_rate"] = summary["pass_rate"]
            report["ci_summary"] = summary
        except github_service.GitHubRateLimitError:
            raise
        except Exception as exc:
            report["errors"].append(f"GitHub: {exc}")

    # 3. AI sprint summary
    try:
        report["ai_summary"] = await generate_sprint_summary(report)
    except AIQuotaError:
        raise
    except Exception as exc:
        # The measured figures are still returned; the summary is absent, not invented.
        report["errors"].append(f"AI summary: {exc}")
        report["ai_summary"] = None

    report["cache"] = cache
    return report


@router.get("/dora")
async def dora_metrics(
    owner: str,
    repo: str,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Compute DORA metrics from GitHub Actions data (30-day window)."""
    runs, cache = await ci_metrics_service.get_workflow_runs(db, org.id, owner, repo, refresh=refresh)
    last_30 = ci_metrics_service.summarise_runs(ci_metrics_service.runs_within(runs, 30))

    return {
        "deployment_frequency_per_week": ci_metrics_service.successful_runs_last_week(runs),
        "change_failure_rate_30d": last_30["failure_rate"],
        "total_runs_30d": last_30["total_runs"],
        "evaluated_runs_30d": last_30["evaluated_runs"],
        "successful_runs_30d": last_30["success_count"],
        "failed_runs_30d": last_30["failure_count"],
        "cache": cache,
    }
