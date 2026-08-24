"""
GitHub REST API service proxy for frontend GitHub integrations.
All calls use the GITHUB_TOKEN from settings (never exposed to the browser).
"""
import asyncio
import base64
from typing import Any

import httpx

from app.config import settings
from app.services import connector_settings_service as connectors

_GITHUB_API = "https://api.github.com"
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _auth_headers(token: str | None = None) -> dict[str, str]:
    h = dict(_HEADERS)
    auth_token = token or connectors.active("github").get("token") or settings.GITHUB_TOKEN
    if auth_token:
        h["Authorization"] = f"Bearer {auth_token}"
    return h


async def _get(path: str, params: dict | None = None, token: str | None = None) -> Any:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(f"{_GITHUB_API}{path}", headers=_auth_headers(token), params=params)
        resp.raise_for_status()
        return resp.json()


async def get_open_prs(owner: str, repo: str, per_page: int = 10) -> list[dict]:
    data = await _get(f"/repos/{owner}/{repo}/pulls", {"state": "open", "per_page": per_page})
    return [
        {
            "number": pr["number"],
            "title": pr["title"],
            "author": pr["user"]["login"],
            "created_at": pr["created_at"],
            "updated_at": pr["updated_at"],
            "url": pr["html_url"],
            "base": pr["base"]["ref"],
            "head": pr["head"]["ref"],
            "additions": pr.get("additions", 0),
            "deletions": pr.get("deletions", 0),
            "changed_files": pr.get("changed_files", 0),
            "body": pr.get("body") or "",
        }
        for pr in data
    ]


async def get_pr_files(owner: str, repo: str, pr_number: int) -> list[dict]:
    data = await _get(f"/repos/{owner}/{repo}/pulls/{pr_number}/files", {"per_page": 100})
    return [
        {
            "filename": f["filename"],
            "status": f["status"],
            "additions": f["additions"],
            "deletions": f["deletions"],
            "patch": f.get("patch", ""),
        }
        for f in data
    ]


async def get_pr_detail(owner: str, repo: str, pr_number: int) -> dict:
    return await _get(f"/repos/{owner}/{repo}/pulls/{pr_number}")


async def get_commits(owner: str, repo: str, since_days: int = 90, per_page: int = 100) -> list[dict]:
    from datetime import datetime, timedelta, timezone
    since = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()
    data = await _get(
        f"/repos/{owner}/{repo}/commits",
        {"since": since, "per_page": per_page},
    )
    result = []
    for c in data:
        result.append({
            "sha": c["sha"],
            "message": c["commit"]["message"],
            "author": c["commit"]["author"]["name"],
            "date": c["commit"]["author"]["date"],
            "files": [],  # filled lazily if needed
        })
    return result


async def get_commit_detail(owner: str, repo: str, sha: str) -> dict:
    return await _get(f"/repos/{owner}/{repo}/commits/{sha}")


async def get_commit_diff(owner: str, repo: str, sha: str, token: str | None = None) -> list[dict]:
    """Return changed files for a commit in the same shape as get_pr_files()."""
    data = await _get(f"/repos/{owner}/{repo}/commits/{sha}", token=token)
    return [
        {
            "filename": f["filename"],
            "status": f.get("status", "modified"),
            "additions": f.get("additions", 0),
            "deletions": f.get("deletions", 0),
            "patch": f.get("patch", ""),
        }
        for f in data.get("files", [])
    ]


async def get_workflow_runs(owner: str, repo: str, per_page: int = 30) -> list[dict]:
    data = await _get(f"/repos/{owner}/{repo}/actions/runs", {"per_page": per_page})
    runs = data.get("workflow_runs", [])
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "status": r["status"],
            "conclusion": r["conclusion"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "head_branch": r["head_branch"],
            "head_sha": r["head_sha"][:7],
            "run_number": r["run_number"],
            "html_url": r["html_url"],
            "run_attempt": r.get("run_attempt", 1),
        }
        for r in runs
    ]


async def get_run_logs_text(owner: str, repo: str, run_id: int) -> str:
    """Download and decode the log zip, return first 10 KB of text."""
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(
                f"{_GITHUB_API}/repos/{owner}/{repo}/actions/runs/{run_id}/logs",
                headers=_auth_headers(),
            )
            if resp.status_code == 404:
                return ""
            resp.raise_for_status()
            import io, zipfile
            with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
                names = z.namelist()
                parts = []
                for name in names[:5]:
                    with z.open(name) as f:
                        parts.append(f"=== {name} ===\n" + f.read(4096).decode("utf-8", errors="ignore"))
                return "\n".join(parts)[:10000]
    except Exception:
        return ""


async def get_repo_languages(owner: str, repo: str) -> dict[str, int]:
    return await _get(f"/repos/{owner}/{repo}/languages")


async def list_workflows(owner: str, repo: str) -> list[dict]:
    data = await _get(f"/repos/{owner}/{repo}/actions/workflows")
    return data.get("workflows", [])


async def get_repo_info(owner: str, repo: str) -> dict:
    return await _get(f"/repos/{owner}/{repo}")
