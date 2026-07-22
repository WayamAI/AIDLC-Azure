"""Jira proxy routes."""
from fastapi import APIRouter, HTTPException, Body

from app.services import jira_service
from app.services.ai_service import generate_acceptance_criteria, AIQuotaError

router = APIRouter(prefix="/jira", tags=["Jira"])


@router.get("/projects")
async def list_projects():
    try:
        return await jira_service.list_projects()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Jira error: {exc}")


@router.get("/stories")
async def get_stories(project: str, sprint_id: str | None = None, max_results: int = 20):
    try:
        return await jira_service.get_sprint_stories(project, sprint_id, max_results)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Jira error: {exc}")


@router.post("/stories/{issue_key}/generate-ac")
async def generate_ac_for_story(issue_key: str, body: dict = Body(default={})):
    """Fetch a Jira story and generate AI acceptance criteria for it."""
    project = body.get("project", issue_key.split("-")[0])
    try:
        stories = await jira_service.get_sprint_stories(project, max_results=30)
        story = next((s for s in stories if s["key"] == issue_key), None)
        if not story:
            # Try fetching all from project
            raise HTTPException(status_code=404, detail=f"Story {issue_key} not found in active sprint")
        existing = [s for s in stories if s["key"] != issue_key]
        result = await generate_acceptance_criteria(story, existing)
        return {"issue_key": issue_key, "story": story, "ai_analysis": result}
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/stories/{issue_key}/update-ac")
async def push_ac_to_jira(issue_key: str, body: dict = Body(...)):
    """Push AI-generated acceptance criteria back to Jira as description update."""
    ac_text: str = body.get("acceptance_criteria_text", "")
    if not ac_text:
        raise HTTPException(status_code=400, detail="acceptance_criteria_text is required")
    try:
        await jira_service.update_issue_description(issue_key, ac_text)
        return {"status": "updated", "issue_key": issue_key}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Jira update failed: {exc}")


@router.get("/bugs")
async def list_bugs(project: str, version: str | None = None):
    try:
        return await jira_service.get_open_bugs(project, version)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Jira error: {exc}")


@router.post("/analyze-manual")
async def analyze_manual_story(body: dict = Body(...)):
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
    try:
        result = await generate_acceptance_criteria(story, [])
        return {"issue_key": "MANUAL-1", "story": story, "ai_analysis": result}
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/analyze-sprint")
async def analyze_sprint(body: dict = Body(...)):
    """Fetch all stories in the active sprint and generate AC for each."""
    project = body.get("project")
    if not project:
        raise HTTPException(status_code=400, detail="project is required")
    try:
        stories = await jira_service.get_sprint_stories(project, max_results=15)
        if not stories:
            return {"stories": [], "total": 0}
        results = []
        for story in stories:
            try:
                existing = [s for s in stories if s["key"] != story["key"]]
                ai_result = await generate_acceptance_criteria(story, existing)
                results.append({"story": story, "ai_analysis": ai_result})
            except Exception:
                results.append({"story": story, "ai_analysis": None, "error": "AI analysis failed"})
        return {"stories": results, "total": len(results)}
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
