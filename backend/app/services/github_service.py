"""
GitHub REST API service proxy for frontend GitHub integrations.
All calls use the GITHUB_TOKEN from settings (never exposed to the browser).
"""
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings
from app.services import connector_settings_service as connectors

_GITHUB_API = "https://api.github.com"
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


class GitHubAPIError(Exception):
    """GitHub answered with an error status."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class GitHubRateLimitError(GitHubAPIError):
    """The GitHub request quota is used up until `reset_at`."""

    def __init__(self, reset_at: datetime | None, authenticated: bool):
        when = f" The limit resets at {reset_at.strftime('%H:%M UTC')}." if reset_at else ""
        hint = "" if authenticated else (
            " Requests are unauthenticated (60 per hour); add a GitHub token under "
            "Settings → Connectors to raise the limit to 5,000 per hour."
        )
        super().__init__(429, f"GitHub rate limit reached.{when}{hint}")
        self.reset_at = reset_at
        self.authenticated = authenticated


def is_authenticated() -> bool:
    """True when a GitHub token is configured (connector or settings)."""
    return bool(connectors.active("github").get("token"))


def raise_for_github_status(resp: httpx.Response, authenticated: bool) -> None:
    """Turn a GitHub error response into GitHubRateLimitError / GitHubAPIError."""
    if resp.status_code < 400:
        return
    try:
        body = resp.json()
        message = str(body.get("message") or "") if isinstance(body, dict) else ""
    except ValueError:
        message = ""
    limited = resp.status_code == 429 or (
        resp.status_code == 403
        and (resp.headers.get("x-ratelimit-remaining") == "0" or "rate limit" in message.lower())
    )
    if limited:
        reset_at = None
        try:
            reset_at = datetime.fromtimestamp(int(resp.headers["x-ratelimit-reset"]), tz=timezone.utc)
        except (KeyError, ValueError):
            pass
        raise GitHubRateLimitError(reset_at, authenticated)
    raise GitHubAPIError(resp.status_code, describe_github_error(resp.status_code, resp.url.path, message, authenticated))


_CONNECTORS_HINT = "Add a GitHub token under Settings → Connectors"


def describe_github_error(status_code: int, path: str, message: str, authenticated: bool) -> str:
    """A sentence a user can act on for a GitHub error, instead of the raw API path and status."""
    parts = [p for p in path.split("/") if p]
    repo = f"{parts[1]}/{parts[2]}" if len(parts) >= 3 and parts[0] == "repos" else "this repository"
    detail = f" (GitHub: {message})" if message else ""
    if status_code == 404:
        if authenticated:
            return f"GitHub could not find {repo}, or the configured token has no access to it. Check the owner and repository name."
        return (
            f"GitHub could not find {repo}. Check the owner and repository name. "
            f"If the repository is private: {_CONNECTORS_HINT[0].lower()}{_CONNECTORS_HINT[1:]}."
        )
    if status_code == 401:
        return f"GitHub rejected the configured token. Check the GitHub token under Settings → Connectors.{detail}"
    if status_code == 403:
        if path.endswith("/logs"):
            who = "The configured token cannot" if authenticated else "Anonymous requests cannot"
            return (
                f"{who} download workflow run logs for {repo}: GitHub only releases them to an account "
                f"with access to the repository. {_CONNECTORS_HINT} that can read {repo}."
            )
        if authenticated:
            return f"The configured GitHub token is not allowed to read this from {repo}.{detail}"
        return f"GitHub does not allow this for {repo} without signing in. {_CONNECTORS_HINT}.{detail}"
    if status_code >= 500:
        return f"GitHub is having problems right now (status {status_code}). Try again in a few minutes."
    return f"GitHub refused the request for {repo} (status {status_code}).{detail}"


def commit_detail_budget() -> int:
    """
    How many per-commit detail calls one analysis may make.

    Each call costs one request against the GitHub rate limit: 5,000/hour when
    authenticated, but only 60/hour unauthenticated. At the old flat 50 a single
    defect-prediction run nearly exhausted an unauthenticated quota for the whole
    machine, and every later call in the hour failed with 403.
    """
    return 50 if is_authenticated() else 12


def _auth_headers(token: str | None = None) -> dict[str, str]:
    h = dict(_HEADERS)
    auth_token = token or connectors.active("github").get("token")
    if auth_token:
        h["Authorization"] = f"Bearer {auth_token}"
    return h


async def _get(path: str, params: dict | None = None, token: str | None = None) -> Any:
    headers = _auth_headers(token)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(f"{_GITHUB_API}{path}", headers=headers, params=params)
        raise_for_github_status(resp, "Authorization" in headers)
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
    """Download and decode the log zip, return first 10 KB of text.

    "" means GitHub has no logs for the run (404: expired or not produced yet).
    Any other failure raises, so it is not mistaken for missing logs.
    """
    headers = _auth_headers()
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(
            f"{_GITHUB_API}/repos/{owner}/{repo}/actions/runs/{run_id}/logs",
            headers=headers,
        )
    if resp.status_code == 404:
        return ""
    raise_for_github_status(resp, "Authorization" in headers)
    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            parts = []
            for name in z.namelist()[:5]:
                with z.open(name) as f:
                    parts.append(f"=== {name} ===\n" + f.read(4096).decode("utf-8", errors="ignore"))
    except zipfile.BadZipFile as exc:
        raise GitHubAPIError(502, f"GitHub returned an unreadable log archive for run {run_id}") from exc
    return "\n".join(parts)[:10000]


async def get_repo_languages(owner: str, repo: str) -> dict[str, int]:
    return await _get(f"/repos/{owner}/{repo}/languages")


async def list_workflows(owner: str, repo: str) -> list[dict]:
    data = await _get(f"/repos/{owner}/{repo}/actions/workflows")
    return data.get("workflows", [])


async def get_repo_info(owner: str, repo: str) -> dict:
    return await _get(f"/repos/{owner}/{repo}")
