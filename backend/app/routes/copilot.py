"""Copilot routes AI code generation, comments, explanation, snippets."""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    SuggestCodeRequest, SuggestCodeResponse,
    AddCommentsRequest, ExplainCodeRequest, ExplainCodeResponse,
    CreateSnippetRequest, SnippetResponse,
    WorkspaceSuggestRequest, WorkspaceSuggestResponse,
)
from app.routes.deps import attach_workspace
from app.services import copilot_service

router = APIRouter(prefix="/copilot", tags=["Copilot"])


@router.post("/suggest", response_model=SuggestCodeResponse)
async def suggest_code(req: SuggestCodeRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate an AI code suggestion and return original/modified diff."""
    result = await copilot_service.suggest_code(
        file_path=req.file_path,
        content=req.content,
        instruction=req.instruction,
        history=[m.model_dump() for m in req.history],
        language=req.language or "",
    )
    return result


@router.post("/add-comments", response_model=SuggestCodeResponse)
async def add_comments(req: AddCommentsRequest, org: OrganizationOut = Depends(get_current_org)):
    """Auto-add docstrings and inline comments to a file."""
    result = await copilot_service.add_comments(
        file_path=req.file_path,
        content=req.content,
        language=req.language or "",
        style=req.style,
    )
    return result


@router.post("/explain", response_model=ExplainCodeResponse)
async def explain_code(req: ExplainCodeRequest, org: OrganizationOut = Depends(get_current_org)):
    """Explain selected code or whole file in plain English."""
    result = await copilot_service.explain_code(
        file_path=req.file_path,
        content=req.content,
        selection=req.selection or "",
        question=req.question or "",
    )
    return result


@router.post("/suggest-workspace", response_model=WorkspaceSuggestResponse, dependencies=[Depends(attach_workspace)])
async def suggest_workspace(req: WorkspaceSuggestRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate AI suggestions across multiple files in a workspace."""
    try:
        result = await copilot_service.suggest_workspace(
            workspace_id=req.workspace_id,
            instruction=req.instruction,
            history=[m.model_dump() for m in req.history],
            context_files=req.context_files,
            org_id=org.id,
        )
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Snippet Library ─────────────────────────────────────────────────────────

@router.get("/snippets")
async def list_snippets(
    lang: str = "",
    tag: str = "",
    workspace_id: str = "",
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """List saved snippets with optional lang/tag/workspace filters."""
    query: dict = {"org_id": org.id}
    if lang:
        query["language"] = lang
    if tag:
        query["tags"] = tag
    if workspace_id:
        query["workspace_id"] = workspace_id
    cursor = db["snippets"].find(query).sort("created_at", -1).limit(100)
    docs = await cursor.to_list(100)
    for doc in docs:
        doc["id"] = str(doc.pop("_id"))
    return docs


@router.post("/snippets", response_model=SnippetResponse)
async def create_snippet(
    req: CreateSnippetRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Save a code snippet to the library."""
    doc = {
        "org_id": org.id,
        "workspace_id": req.workspace_id,
        "name": req.name,
        "code": req.code,
        "language": req.language,
        "tags": req.tags,
        "usage_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db["snippets"].insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc


@router.delete("/snippets/{snippet_id}")
async def delete_snippet(
    snippet_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Delete a snippet by ID."""
    from bson import ObjectId
    if not ObjectId.is_valid(snippet_id):
        raise HTTPException(status_code=404, detail="Snippet not found")
    result = await db["snippets"].delete_one({"_id": ObjectId(snippet_id), "org_id": org.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"status": "deleted", "id": snippet_id}
