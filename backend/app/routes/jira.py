"""Jira proxy routes.

Jira not configured is a 503 and an LLM failure a 429/502, both from the
app-level handlers (app.errors); nothing here re-wraps them.
"""
import asyncio

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.services import jira_service
from app.services.ai_service import AIQuotaError, generate_acceptance_criteria

router = APIRouter(prefix="/jira", tags=["Jira"])


@router.get("/projects")
async def list_projects(org: OrganizationOut = Depends(get_current_org)):
    return await jira_service.list_projects()


@router.get("/stories")
async def get_stories(
    project: str,
    sprint_id: str | None = None,
    max_results: int = 20,
    org: OrganizationOut = Depends(get_current_org),
):
    return await jira_service.get_sprint_stories(project, sprint_id, max_results)


@router.post("/stories/{issue_key}/generate-ac")
async def generate_ac_for_story(
    issue_key: str,
    body: dict = Body(default={}),
    org: OrganizationOut = Depends(get_current_org),
):
    """Fetch a Jira story and generate AI acceptance criteria for it."""
    project = body.get("project", issue_key.split("-")[0])
    stories = await jira_service.get_sprint_stories(project, max_results=30)
    story = next((s for s in stories if s["key"] == issue_key), None)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story {issue_key} not found in active sprint")
    existing = [s for s in stories if s["key"] != issue_key]
    result = await generate_acceptance_criteria(story, existing)
    return {"issue_key": issue_key, "story": story, "ai_analysis": result}


@router.post("/stories/{issue_key}/update-ac")
async def push_ac_to_jira(
    issue_key: str,
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
):
    """Post AI-generated acceptance criteria to the Jira issue as a comment."""
    ac_text: str = (body.get("acceptance_criteria_text") or "").strip()
    if not ac_text:
        raise HTTPException(status_code=400, detail="acceptance_criteria_text is required")
    comment = await jira_service.add_issue_comment(issue_key, ac_text)
    return {"status": "commented", "issue_key": issue_key, "comment_id": comment["id"]}


@router.get("/bugs")
async def list_bugs(
    project: str,
    version: str | None = None,
    org: OrganizationOut = Depends(get_current_org),
):
    return await jira_service.get_open_bugs(project, version)


@router.post("/analyze-manual")
async def analyze_manual_story(body: dict = Body(...), org: OrganizationOut = Depends(get_current_org)):
    """
    Analyze a manually typed user story no Jira connection needed.
    Accepts: summary (required), description (optional), priority (optional).
    """
    summary = (body.get("summary") or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="summary is required")
    story = {
        "key": "MANUAL-1",
        "summary": summary,
        "description": body.get("description") or "",
        "priority": body.get("priority") or "Medium",
        "status": "Open",
        "assignee": "Unassigned",
    }
    result = await generate_acceptance_criteria(story, [])
    return {"issue_key": "MANUAL-1", "story": story, "ai_analysis": result}


@router.post("/analyze-sprint")
async def analyze_sprint(body: dict = Body(...), org: OrganizationOut = Depends(get_current_org)):
    """Fetch all stories in the active sprint and generate AC for each.

    Stories are analysed concurrently (bounded by the LLM concurrency limit). A
    story whose analysis failed has `ai_analysis: null` and the reason in `error`;
    `failed` counts them. If every story failed on the AI quota the response is 429.
    """
    project = body.get("project")
    if not project:
        raise HTTPException(status_code=400, detail="project is required")
    stories = await jira_service.get_sprint_stories(project, max_results=15)
    if not stories:
        return {"stories": [], "total": 0, "failed": 0}

    async def _analyse(story: dict) -> dict:
        existing = [s for s in stories if s["key"] != story["key"]]
        return await generate_acceptance_criteria(story, existing)

    outcomes = await asyncio.gather(*(_analyse(s) for s in stories), return_exceptions=True)
    failures = [o for o in outcomes if isinstance(o, BaseException)]
    if failures and len(failures) == len(stories) and all(isinstance(f, AIQuotaError) for f in failures):
        raise failures[0]

    results = []
    for story, outcome in zip(stories, outcomes):
        if isinstance(outcome, BaseException):
            results.append({
                "story": story,
                "ai_analysis": None,
                "error": f"AI analysis failed: {str(outcome)[:300] or type(outcome).__name__}",
            })
        else:
            results.append({"story": story, "ai_analysis": outcome})
    return {"stories": results, "total": len(results), "failed": len(failures)}
