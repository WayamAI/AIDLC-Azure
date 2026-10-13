"""
Defect Prediction routes.
Computes per-file risk scores from GitHub commit history.
"""
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ci_metrics_service, github_service
from app.services.ai_service import generate_defect_risk_narrative

router = APIRouter(prefix="/defect-prediction", tags=["Defect Prediction"])

_BUG_KEYWORDS = {"fix", "bug", "hotfix", "patch", "defect", "issue", "error", "crash", "regression", "revert"}


def _is_bug_fix(message: str) -> bool:
    lower = message.lower()
    return any(k in lower for k in _BUG_KEYWORDS)


def _normalise(values: list[float]) -> list[float]:
    if not values:
        return values
    max_v = max(values) or 1
    return [v / max_v for v in values]


@router.get("/risk-scores")
async def compute_risk_scores(
    owner: str,
    repo: str,
    since_days: int = 90,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Analyse commit history and score each changed file for defect risk.
    Returns top 20 highest-risk files + AI narrative.

    `total_commits_analysed` is the number of commits whose file list was
    actually read; `commits_failed` lists the ones that could not be read.
    `narrative` is null when the AI call failed, with the reason in `narrative_error`.
    """
    commits, cache = await ci_metrics_service.get_commits(db, org.id, owner, repo, since_days, refresh=refresh)

    if not commits:
        return {
            "files": [],
            "narrative": None,
            "message": "No commits found in the specified time range.",
            "total_commits": 0,
            "total_commits_analysed": 0,
            "cache": cache,
        }

    # Budget scales with auth: 50 with a token, far fewer without, so one run
    # cannot burn an unauthenticated 60/hour quota. See github_service.
    # Commit file lists are cached (a commit never changes), so a repeat run is free.
    sampled = commits[:github_service.commit_detail_budget()]
    outcomes = await ci_metrics_service.get_commit_files_many(
        db, org.id, owner, repo, [c["sha"] for c in sampled]
    )

    file_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "change_count": 0,
        "bug_fix_count": 0,
        "authors": set(),
        "additions": 0,
        "deletions": 0,
    })
    commits_failed: list[dict[str, str]] = []
    analysed = 0
    for commit, files in zip(sampled, outcomes):
        if isinstance(files, BaseException):
            commits_failed.append({"sha": commit["sha"][:7], "error": str(files)[:200]})
            continue
        analysed += 1
        is_bug = _is_bug_fix(commit["message"])
        for f in files:
            stats = file_stats[f["filename"]]
            stats["change_count"] += 1
            if is_bug:
                stats["bug_fix_count"] += 1
            stats["authors"].add(commit["author"])
            stats["additions"] += f.get("additions", 0)
            stats["deletions"] += f.get("deletions", 0)

    if not analysed:
        # Nothing was read, so there is nothing to score; say why instead of an empty result.
        rate_limited = next(
            (o for o in outcomes if isinstance(o, github_service.GitHubRateLimitError)), None
        )
        if rate_limited:
            raise rate_limited
        raise github_service.GitHubAPIError(
            502, f"Could not read any of the {len(sampled)} sampled commits: {commits_failed[0]['error']}"
        )

    # Compute raw metrics
    all_files = list(file_stats.items())
    change_counts = [s["change_count"] for _, s in all_files]
    bug_ratios = [s["bug_fix_count"] / s["change_count"] if s["change_count"] else 0 for _, s in all_files]
    churn_vals = [(s["additions"] + s["deletions"]) for _, s in all_files]
    author_counts = [len(s["authors"]) for _, s in all_files]

    change_norms = _normalise(change_counts)
    churn_norms = _normalise(churn_vals)
    author_norms = _normalise(author_counts)

    scored = []
    for i, (filename, stats) in enumerate(all_files):
        bug_ratio = bug_ratios[i]
        risk_score = round(
            change_norms[i] * 0.30 * 100 +
            bug_ratio * 0.35 * 100 +
            churn_norms[i] * 0.20 * 100 +
            author_norms[i] * 0.15 * 100
        )
        scored.append({
            "filename": filename,
            "risk_score": min(risk_score, 100),
            "change_count": stats["change_count"],
            "bug_fix_count": stats["bug_fix_count"],
            "bug_fix_ratio": round(bug_ratio * 100, 1),
            "author_count": len(stats["authors"]),
            "churn": stats["additions"] + stats["deletions"],
            "risk_level": "critical" if risk_score >= 75 else "high" if risk_score >= 50 else "medium" if risk_score >= 25 else "low",
        })

    scored.sort(key=lambda x: x["risk_score"], reverse=True)
    top_files = scored[:20]

    # AI narrative: the scores above stand whether or not this succeeds.
    narrative = None
    narrative_error = None
    if top_files:
        try:
            narrative = await generate_defect_risk_narrative(top_files[:10])
        except Exception as exc:
            narrative_error = str(exc)[:300] or type(exc).__name__

    return {
        "files": top_files,
        "narrative": narrative,
        "narrative_error": narrative_error,
        "total_commits": len(commits),
        "total_commits_analysed": analysed,
        "commits_failed": commits_failed,
        "total_files_analysed": len(scored),
        "high_risk_count": sum(1 for f in scored if f["risk_score"] >= 50),
        "cache": cache,
    }
