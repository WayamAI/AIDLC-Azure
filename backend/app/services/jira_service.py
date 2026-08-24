"""
Jira REST API v3 service.
Uses Basic auth: base64(email:token).
NOTE: Uses POST /rest/api/3/search/jql (the old GET /search was deprecated in 2025 and returns 410).
"""
import base64
from typing import Any

import httpx

from app.config import settings
from app.services import connector_settings_service as connectors


def _jira_cfg() -> dict[str, str]:
    return connectors.active("jira")


def _auth_header() -> str:
    cfg = _jira_cfg()
    email = (cfg.get("email") or settings.JIRA_EMAIL or "").strip()
    token = (cfg.get("token") or settings.JIRA_TOKEN or "").strip()
    creds = f"{email}:{token}"
    return "Basic " + base64.b64encode(creds.encode()).decode()


def _headers() -> dict[str, str]:
    return {
        "Authorization": _auth_header(),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _base_url() -> str:
    cfg = _jira_cfg()
    domain = (cfg.get("domain") or settings.JIRA_DOMAIN or "").strip().rstrip("/")
    if domain.startswith("http"):
        return domain
    return f"https://{domain}" if domain else settings.jira_base_url


async def _get(path: str, params: dict | None = None) -> Any:
    url = f"{_base_url()}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=_headers(), params=params)
        resp.raise_for_status()
        return resp.json()


async def _post(path: str, body: dict) -> Any:
    url = f"{_base_url()}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        resp.raise_for_status()
        return resp.json()


async def _put(path: str, body: dict) -> Any:
    url = f"{_base_url()}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(url, headers=_headers(), json=body)
        resp.raise_for_status()
        return resp.text or {}


async def _search(jql: str, max_results: int = 20, fields: list[str] | None = None) -> list[dict]:
    """Search using POST /rest/api/3/search/jql (current Jira API)."""
    payload: dict[str, Any] = {
        "jql": jql,
        "maxResults": max_results,
        "fields": fields or ["summary", "description", "status", "priority", "assignee", "issuetype", "labels"],
    }
    data = await _post("/rest/api/3/search/jql", payload)
    return data.get("issues", [])


async def list_projects() -> list[dict]:
    data = await _get("/rest/api/3/project/search", {"maxResults": 50})
    return [
        {"key": p["key"], "name": p["name"], "id": p["id"]}
        for p in data.get("values", [])
    ]


async def get_active_sprint_stories(project_key: str, max_results: int = 20) -> list[dict]:
    """Fetch stories from the current active sprint, with fallback to recent issues."""
    try:
        issues = await _search(
            f"project={project_key} AND sprint in openSprints() ORDER BY created DESC",
            max_results,
        )
        return [_normalise_issue(i) for i in issues]
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 410):
            # openSprints() not available or project has no sprints fallback
            issues = await _search(
                f"project={project_key} ORDER BY created DESC",
                max_results,
            )
            return [_normalise_issue(i) for i in issues]
        raise


async def get_sprint_stories(project_key: str, sprint_id: str | None = None, max_results: int = 20) -> list[dict]:
    """Fetch sprint stories with sprint-filter fallback to recent issues."""
    if sprint_id:
        jql = f"project={project_key} AND sprint={sprint_id} ORDER BY created DESC"
    else:
        jql = f"project={project_key} AND sprint in openSprints() ORDER BY created DESC"
    try:
        issues = await _search(jql, max_results)
        return [_normalise_issue(i) for i in issues]
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 410):
            # Sprint JQL unavailable fallback to recent issues
            issues = await _search(
                f"project={project_key} ORDER BY created DESC",
                max_results,
            )
            return [_normalise_issue(i) for i in issues]
        raise


async def get_open_bugs(project_key: str, version: str | None = None) -> list[dict]:
    jql = f"project={project_key} AND issuetype=Bug AND status != Done"
    if version:
        jql += f" AND fixVersion='{version}'"
    jql += " ORDER BY priority ASC"
    try:
        issues = await _search(jql, max_results=50)
        return [_normalise_issue(i) for i in issues]
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 410):
            # issuetype filter may fail if no bugs exist return empty
            return []
        raise


async def update_issue_description(issue_key: str, new_description_text: str) -> None:
    """Update a Jira issue description using Atlassian Document Format."""
    body = {
        "fields": {
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": new_description_text}],
                    }
                ],
            }
        }
    }
    await _put(f"/rest/api/3/issue/{issue_key}", body)


def _normalise_issue(issue: dict) -> dict:
    fields = issue.get("fields", {})
    desc = ""
    raw_desc = fields.get("description")
    if raw_desc and isinstance(raw_desc, dict):
        desc = _extract_adf_text(raw_desc)
    elif isinstance(raw_desc, str):
        desc = raw_desc

    priority = fields.get("priority") or {}
    assignee = fields.get("assignee") or {}
    return {
        "key": issue["key"],
        "summary": fields.get("summary", ""),
        "description": desc,
        "status": (fields.get("status") or {}).get("name", ""),
        "priority": priority.get("name", "Medium"),
        "assignee": assignee.get("displayName", "Unassigned"),
        "issue_type": (fields.get("issuetype") or {}).get("name", "Story"),
        "labels": fields.get("labels", []),
    }


def _extract_adf_text(adf: dict) -> str:
    """Recursively extract plain text from Atlassian Document Format."""
    parts = []
    if adf.get("type") == "text":
        parts.append(adf.get("text", ""))
    for child in adf.get("content", []):
        parts.append(_extract_adf_text(child))
    return " ".join(p for p in parts if p).strip()
