"""
Defect Prediction routes.
Computes per-file risk scores from GitHub commit history.
"""
import math
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, HTTPException

from app.services import github_service
from app.services.ai_service import generate_defect_risk_narrative, AIQuotaError

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
async def compute_risk_scores(owner: str, repo: str, since_days: int = 90):
    """
    Analyse commit history and score each changed file for defect risk.
    Returns top 20 highest-risk files + AI narrative.
    """
    try:
        commits = await github_service.get_commits(owner, repo, since_days)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not commits:
        return {"files": [], "narrative": "No commits found in the specified time range.", "total_commits": 0}

    # Collect per-file stats
    file_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "change_count": 0,
        "bug_fix_count": 0,
        "authors": set(),
        "additions": 0,
        "deletions": 0,
    })

    # Fetch details for up to 50 commits to get file-level data
    for commit in commits[:50]:
        sha = commit["sha"]
        try:
            detail = await github_service.get_commit_detail(owner, repo, sha)
            is_bug = _is_bug_fix(commit["message"])
            for f in detail.get("files", []):
                fname = f["filename"]
                file_stats[fname]["change_count"] += 1
                if is_bug:
                    file_stats[fname]["bug_fix_count"] += 1
                file_stats[fname]["authors"].add(commit["author"])
                file_stats[fname]["additions"] += f.get("additions", 0)
                file_stats[fname]["deletions"] += f.get("deletions", 0)
        except Exception:
            continue

    if not file_stats:
        return {"files": [], "narrative": "Could not retrieve file-level data.", "total_commits": len(commits)}

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

    # AI narrative
    try:
        narrative = await generate_defect_risk_narrative(top_files[:10])
    except AIQuotaError:
        narrative = "AI narrative unavailable quota exceeded."
    except Exception:
        narrative = "AI narrative unavailable."

    return {
        "files": top_files,
        "narrative": narrative,
        "total_commits_analysed": min(len(commits), 50),
        "total_files_analysed": len(scored),
        "high_risk_count": sum(1 for f in scored if f["risk_score"] >= 50),
    }
