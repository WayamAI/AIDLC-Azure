"""GitHub proxy routes shields the GITHUB_TOKEN from the browser."""
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.services import github_service
from app.services.ai_service import review_pull_request, explain_ci_failure, AIQuotaError

router = APIRouter(prefix="/github", tags=["GitHub"])


def _require_repo(owner: str, repo: str) -> None:
    if not owner.strip() or not repo.strip():
        raise HTTPException(status_code=422, detail="owner and repo are required")


@router.get("/repo-info")
async def repo_info(owner: str, repo: str):
    _require_repo(owner, repo)
    try:
        return await github_service.get_repo_info(owner, repo)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/prs")
async def list_prs(owner: str, repo: str, per_page: int = 10):
    _require_repo(owner, repo)
    try:
        return await github_service.get_open_prs(owner, repo, per_page)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/pr/{pr_number}/files")
async def pr_files(owner: str, repo: str, pr_number: int):
    try:
        return await github_service.get_pr_files(owner, repo, pr_number)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pr/{pr_number}/review")
async def ai_review_pr(owner: str, repo: str, pr_number: int):
    """Fetch PR files and run AI code review."""
    try:
        detail = await github_service.get_pr_detail(owner, repo, pr_number)
        files = await github_service.get_pr_files(owner, repo, pr_number)
        review = await review_pull_request(
            detail.get("title", ""),
            detail.get("body") or "",
            files,
        )
        return {
            "pr_number": pr_number,
            "pr_title": detail.get("title", ""),
            "author": detail.get("user", {}).get("login", ""),
            "review": review,
            "files_reviewed": len(files),
            "engine_version": review.get("meta", {}).get("engine_version", "v1"),
            "review_v2_enabled": settings.PR_REVIEW_V2_ENABLED,
        }
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/commits")
async def list_commits(owner: str, repo: str, since_days: int = 90):
    try:
        return await github_service.get_commits(owner, repo, since_days)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


from pydantic import BaseModel

class ReviewCommitRequest(BaseModel):
    custom_rules: Optional[str] = None

@router.post("/commits/{sha}/review")
async def review_commit(sha: str, owner: str, repo: str, pat: Optional[str] = None, req: Optional[ReviewCommitRequest] = None):
    """Fetch a commit's diff and run AI code review (no PR required)."""
    try:
        files = await github_service.get_commit_diff(owner, repo, sha, pat)
        if not files:
            return {
                "sha": sha,
                "review": {
                    "summary": "No file changes found for this commit.",
                    "findings": [],
                    "security_flags": [],
                    "positives": [],
                    "recommendation": "CONDITIONAL",
                    "coverage_estimate": 0,
                },
                "files_reviewed": 0,
            }
            
        custom_rules = req.custom_rules if req else None
        
        review = await review_pull_request(
            pr_title=f"Commit {sha[:7]}",
            pr_body="",
            files=files,
            custom_rules=custom_rules,
        )
        return {"sha": sha, "review": review, "files_reviewed": len(files)}
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/workflow-runs")
async def workflow_runs(owner: str, repo: str, per_page: int = 30):
    try:
        return await github_service.get_workflow_runs(owner, repo, per_page)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/workflow-runs/{run_id}/explain")
async def explain_run_failure(owner: str, repo: str, run_id: int):
    """Download CI logs and use AI to explain the failure."""
    try:
        logs = await github_service.get_run_logs_text(owner, repo, run_id)
        if not logs:
            return {"explanation": "No logs available for this run.", "fix": "", "category": "unknown", "confidence": 0.0, "is_flaky_candidate": False}
        languages = await github_service.get_repo_languages(owner, repo)
        primary_lang = max(languages, key=languages.get) if languages else "Unknown"

        # Extract failure signature from logs
        error_lines = [l for l in logs.splitlines() if any(k in l.lower() for k in ("error", "failed", "exception", "assert"))]
        error_message = "\n".join(error_lines[:20])
        step = "CI Workflow"
        for line in logs.splitlines():
            if "##[error]" in line or "FAILED" in line:
                step = line[:200]
                break

        result = await explain_ci_failure(step, error_message, logs[:2000], primary_lang)
        return result
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
