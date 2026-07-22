from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.config import settings

VERCEL_API_BASE = "https://api.vercel.com"
GITHUB_API_BASE = "https://api.github.com"


class VercelServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _auth_headers() -> dict[str, str]:
    if not settings.VERCEL_TOKEN:
        raise VercelServiceError(
            "Server missing VERCEL_TOKEN configuration.",
            status_code=500,
        )

    return {
        "Authorization": f"Bearer {settings.VERCEL_TOKEN}",
        "Content-Type": "application/json",
    }


def _build_query_params(skip_auto_detection_confirmation: bool = False) -> dict[str, str]:
    params: dict[str, str] = {}
    if settings.VERCEL_TEAM_ID and not _looks_like_placeholder(settings.VERCEL_TEAM_ID):
        params["teamId"] = settings.VERCEL_TEAM_ID
    if skip_auto_detection_confirmation:
        # For first-time project creation, let Vercel auto-detect framework settings.
        params["skipAutoDetectionConfirmation"] = "1"
    return params


def _looks_like_placeholder(value: str | None) -> bool:
    if not value:
        return True
    lowered = value.strip().lower()
    if not lowered:
        return True
    # Common placeholder patterns copied from docs/templates.
    if "xxxxxxxx" in lowered or "your_" in lowered or "example" in lowered:
        return True
    if lowered in {"team_xxxxxxxxxxxxxxxxxxxx", "prj_xxxxxxxxxxxxxxxxxxxx"}:
        return True
    return False


def _github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    return headers


def _extract_error_message(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "Unexpected Vercel API error."

    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("code") or "Vercel API error")
    if isinstance(error, str):
        return error

    message = payload.get("message")
    if isinstance(message, str) and message:
        return message

    return "Unexpected Vercel API error."


def _extract_actor(payload: dict[str, Any] | None) -> dict[str, str | None] | None:
    if not payload or not isinstance(payload, dict):
        return None

    creator = payload.get("creator")
    if not isinstance(creator, dict):
        return None

    return {
        "id": creator.get("uid") or creator.get("id"),
        "username": creator.get("username") or creator.get("name") or creator.get("login"),
        "email": creator.get("email"),
    }


def _normalize_event_log(event: dict[str, Any]) -> dict[str, Any]:
    level = (
        str(event.get("type") or event.get("level") or event.get("state") or "info")
        .strip()
        .lower()
    )
    timestamp = event.get("created") or event.get("createdAt") or event.get("date")

    raw_message = event.get("text") or event.get("message") or event.get("payload") or event.get("name")
    if isinstance(raw_message, (dict, list)):
        message = json.dumps(raw_message, ensure_ascii=True)
    else:
        message = str(raw_message or "").strip()

    return {
        "id": str(event.get("id") or event.get("created") or event.get("createdAt") or ""),
        "level": level,
        "message": message,
        "timestamp": timestamp,
    }


def parse_github_repo(repo_url: str) -> tuple[str, str]:
    raw = repo_url.strip().removesuffix(".git")
    if not raw:
        raise VercelServiceError("repo_url is required", 400)

    # Supports:
    # - https://github.com/owner/repo
    # - github.com/owner/repo
    # - owner/repo
    normalized = raw.replace("https://", "").replace("http://", "")
    if normalized.startswith("www."):
        normalized = normalized[4:]
    if normalized.startswith("github.com/"):
        normalized = normalized[len("github.com/") :]

    parts = [p for p in normalized.split("/") if p]
    if len(parts) < 2:
        raise VercelServiceError(
            "Invalid repo_url. Expected https://github.com/<owner>/<repo>",
            400,
        )

    owner = parts[0]
    repo = parts[1]

    if not re.match(r"^[A-Za-z0-9_.-]+$", owner) or not re.match(r"^[A-Za-z0-9_.-]+$", repo):
        raise VercelServiceError("Invalid GitHub owner/repo format.", 400)

    return owner, repo


async def _fetch_repo_info(owner: str, repo: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}",
                headers=_github_headers(),
            )
        body = resp.json() if resp.content else {}
        if not resp.is_success:
            message = body.get("message") if isinstance(body, dict) else None
            raise VercelServiceError(
                f"Failed to read repo metadata from GitHub: {message or resp.status_code}",
                400,
            )
        return body
    except httpx.RequestError as exc:
        raise VercelServiceError(f"Failed to contact GitHub API: {exc}", 502) from exc


async def _fetch_repo_branches(owner: str, repo: str, per_page: int = 30) -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/branches",
                headers=_github_headers(),
                params={"per_page": per_page},
            )
        body = resp.json() if resp.content else []
        if not resp.is_success or not isinstance(body, list):
            return []
        branches: list[dict[str, Any]] = []
        for branch in body:
            branches.append(
                {
                    "name": branch.get("name"),
                    "sha": (branch.get("commit") or {}).get("sha"),
                    "protected": bool(branch.get("protected")),
                }
            )
        return branches
    except Exception:
        return []


async def _fetch_recent_commits(owner: str, repo: str, branch: str, per_page: int = 15) -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits",
                headers=_github_headers(),
                params={"sha": branch, "per_page": per_page},
            )
        body = resp.json() if resp.content else []
        if not resp.is_success or not isinstance(body, list):
            return []
        commits: list[dict[str, Any]] = []
        for item in body:
            commit = item.get("commit") or {}
            author = commit.get("author") or {}
            commits.append(
                {
                    "sha": item.get("sha"),
                    "short_sha": (item.get("sha") or "")[:7],
                    "message": (commit.get("message") or "").split("\n")[0],
                    "author": author.get("name") or "unknown",
                    "date": author.get("date"),
                }
            )
        return commits
    except Exception:
        return []


def _build_trigger_payload(repo_id: str, ref: str, target: str, project_name: str) -> dict[str, Any]:
    if not project_name:
        raise VercelServiceError(
            "Missing VERCEL project name. Set VERCEL_PROJECT_NAME in backend env.",
            status_code=500,
        )
    if not repo_id:
        raise VercelServiceError(
            "Missing GitHub repo ID. Provide repo_url or set GITHUB_REPO_ID in backend env.",
            status_code=500,
        )

    payload: dict[str, Any] = {
        "name": project_name,
        "target": target,
        "gitSource": {
            "type": "github",
            "repoId": repo_id,
            "ref": ref,
        },
    }

    if settings.VERCEL_PROJECT_ID and not _looks_like_placeholder(settings.VERCEL_PROJECT_ID):
        payload["project"] = settings.VERCEL_PROJECT_ID

    return payload


async def get_repo_options(repo_url: str, branch: str | None = None) -> dict[str, Any]:
    owner, repo = parse_github_repo(repo_url)
    repo_info = await _fetch_repo_info(owner, repo)
    default_branch = repo_info.get("default_branch") or "main"
    selected_branch = (branch or default_branch).strip() or default_branch
    branches = await _fetch_repo_branches(owner, repo)
    commits = await _fetch_recent_commits(owner, repo, selected_branch)

    return {
        "repo": {
            "owner": owner,
            "name": repo,
            "id": str(repo_info.get("id") or ""),
            "default_branch": default_branch,
            "url": f"https://github.com/{owner}/{repo}",
        },
        "branches": branches,
        "selected_branch": selected_branch,
        "commits": commits,
    }


async def trigger_deployment(
    branch: str,
    target: str,
    repo_url: str | None = None,
    commit_sha: str | None = None,
) -> dict[str, Any]:
    resolved_repo_id = settings.GITHUB_REPO_ID
    resolved_repo_url = ""

    if repo_url:
        owner, repo = parse_github_repo(repo_url)
        repo_info = await _fetch_repo_info(owner, repo)
        resolved_repo_id = str(repo_info.get("id") or "")
        resolved_repo_url = f"https://github.com/{owner}/{repo}"

    ref = (commit_sha or branch).strip()
    if not ref:
        raise VercelServiceError("branch or commit_sha is required", 400)

    project_name = settings.VERCEL_PROJECT_NAME
    if not project_name and repo_url:
        project_name = parse_github_repo(repo_url)[1]

    payload = _build_trigger_payload(
        repo_id=resolved_repo_id,
        ref=ref,
        target=target,
        project_name=project_name,
    )
    has_project_id = bool(settings.VERCEL_PROJECT_ID) and not _looks_like_placeholder(settings.VERCEL_PROJECT_ID)
    params = _build_query_params(skip_auto_detection_confirmation=not has_project_id)

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{VERCEL_API_BASE}/v13/deployments",
                headers=_auth_headers(),
                params=params,
                json=payload,
            )

        body = resp.json() if resp.content else {}
        if not resp.is_success:
            raise VercelServiceError(
                _extract_error_message(body),
                status_code=resp.status_code,
            )

        return {
            "deploymentId": body.get("id"),
            "url": body.get("url"),
            "status": body.get("readyState", "QUEUED"),
            "createdAt": body.get("createdAt"),
            "inspectorUrl": body.get("inspectorUrl"),
            "triggeredBy": _extract_actor(body),
            "projectName": body.get("name") or project_name,
            "domains": body.get("alias") if isinstance(body.get("alias"), list) else [],
            "target": body.get("target") or target,
            "sourceBranch": ref,
            "sourceCommitSha": commit_sha,
            "repoUrl": resolved_repo_url or None,
            "branch": branch,
            "commitSha": commit_sha,
            "ref": ref,
        }
    except httpx.TimeoutException as exc:
        raise VercelServiceError("Timed out while contacting Vercel API.", 504) from exc
    except httpx.RequestError as exc:
        raise VercelServiceError(f"Failed to contact Vercel API: {exc}", 502) from exc


async def get_deployment_status(deployment_id: str) -> dict[str, Any]:
    params = _build_query_params()

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{VERCEL_API_BASE}/v13/deployments/{deployment_id}",
                headers=_auth_headers(),
                params=params,
            )

        body = resp.json() if resp.content else {}
        if not resp.is_success:
            raise VercelServiceError(
                _extract_error_message(body),
                status_code=resp.status_code,
            )

        return {
            "deploymentId": body.get("id", deployment_id),
            "status": body.get("readyState", "UNKNOWN"),
            "url": body.get("url"),
            "createdAt": body.get("createdAt"),
            "inspectorUrl": body.get("inspectorUrl"),
            "triggeredBy": _extract_actor(body),
            "projectName": body.get("name"),
            "domains": body.get("alias") if isinstance(body.get("alias"), list) else [],
            "target": body.get("target"),
            "sourceBranch": (body.get("meta") or {}).get("githubCommitRef"),
            "sourceCommitSha": (body.get("meta") or {}).get("githubCommitSha"),
            "sourceCommitMessage": (body.get("meta") or {}).get("githubCommitMessage"),
            "sourceRepo": (body.get("meta") or {}).get("githubCommitRepo"),
            "ready": body.get("readyState") == "READY",
        }
    except httpx.TimeoutException as exc:
        raise VercelServiceError("Timed out while fetching deployment status.", 504) from exc
    except httpx.RequestError as exc:
        raise VercelServiceError(f"Failed to contact Vercel API: {exc}", 502) from exc


async def get_deployment_events(deployment_id: str, limit: int = 120) -> dict[str, Any]:
    params = _build_query_params()
    params["limit"] = str(max(10, min(limit, 300)))

    endpoints = [
        f"{VERCEL_API_BASE}/v13/deployments/{deployment_id}/events",
        f"{VERCEL_API_BASE}/v6/deployments/{deployment_id}/events",
        f"{VERCEL_API_BASE}/v2/deployments/{deployment_id}/events",
    ]

    last_payload: dict[str, Any] | None = None
    last_status = 502

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for endpoint in endpoints:
                resp = await client.get(endpoint, headers=_auth_headers(), params=params)
                body: Any = resp.json() if resp.content else []

                if resp.is_success:
                    events_raw: list[dict[str, Any]] = []
                    if isinstance(body, list):
                        events_raw = [item for item in body if isinstance(item, dict)]
                    elif isinstance(body, dict):
                        candidate = body.get("events")
                        if isinstance(candidate, list):
                            events_raw = [item for item in candidate if isinstance(item, dict)]

                    return {
                        "deploymentId": deployment_id,
                        "events": [_normalize_event_log(event) for event in events_raw],
                    }

                if isinstance(body, dict):
                    last_payload = body
                last_status = resp.status_code

        raise VercelServiceError(
            _extract_error_message(last_payload) if last_payload else "Unable to fetch deployment events.",
            status_code=last_status,
        )
    except httpx.TimeoutException as exc:
        raise VercelServiceError("Timed out while fetching deployment logs.", 504) from exc
    except httpx.RequestError as exc:
        raise VercelServiceError(f"Failed to contact Vercel API: {exc}", 502) from exc


def deployment_config_health() -> dict[str, Any]:
    team_placeholder = _looks_like_placeholder(settings.VERCEL_TEAM_ID)
    project_placeholder = _looks_like_placeholder(settings.VERCEL_PROJECT_ID)

    return {
        "configured": bool(settings.VERCEL_TOKEN and settings.VERCEL_PROJECT_NAME),
        "project_name": settings.VERCEL_PROJECT_NAME,
        "has_project_id": bool(settings.VERCEL_PROJECT_ID),
        "has_team_id": bool(settings.VERCEL_TEAM_ID),
        "project_id_placeholder": project_placeholder,
        "team_id_placeholder": team_placeholder,
        "has_repo_id": bool(settings.GITHUB_REPO_ID),
        "dynamic_repo_supported": True,
    }