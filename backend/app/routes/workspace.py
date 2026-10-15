"""Workspace routes repo connect, file tree, file content CRUD."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    ConnectRepoRequest, WorkspaceInfo, FileContentResponse, SaveFileRequest,
)
from app.routes.deps import attach_workspace
from app.services import workspace_service

router = APIRouter(prefix="/workspace", tags=["Workspace"], dependencies=[Depends(attach_workspace)])


@router.post("/connect", response_model=WorkspaceInfo)
async def connect_repo(
    req: ConnectRepoRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Clone a GitHub repo (shallow) and return workspace_id + file tree."""
    try:
        return await workspace_service.connect_repo(
            org.id,
            repo_url=req.github_url,
            branch=req.branch,
            pat=req.pat,
            db=db,
        )
    except ValueError as exc:
        # Clone refused: bad URL, unknown branch, or no access to the repository.
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{workspace_id}/tree")
async def get_tree(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    """Return the current file tree for the workspace."""
    try:
        tree = await asyncio.to_thread(workspace_service.get_file_tree, org.id, workspace_id)
        return {"workspace_id": workspace_id, "tree": tree}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")


@router.get("/{workspace_id}/file", response_model=FileContentResponse)
async def get_file(workspace_id: str, path: str, org: OrganizationOut = Depends(get_current_org)):
    """Return content of a single file."""
    try:
        return await asyncio.to_thread(workspace_service.get_file_content, org.id, workspace_id, path)
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.put("/{workspace_id}/file")
async def save_file(workspace_id: str, path: str, req: SaveFileRequest, org: OrganizationOut = Depends(get_current_org)):
    """Save file content locally (does not commit)."""
    try:
        await asyncio.to_thread(workspace_service.save_file_content, org.id, workspace_id, path, req.content)
        return {"status": "saved", "path": path}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Clean up cloned repo directory."""
    try:
        await workspace_service.delete_workspace(org.id, workspace_id, db=db)
        return {"status": "deleted", "workspace_id": workspace_id}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
