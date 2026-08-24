"""Workspace routes repo connect, file tree, file content CRUD."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    ConnectRepoRequest, WorkspaceInfo, FileContentResponse, SaveFileRequest,
)
from app.services import workspace_service

router = APIRouter(prefix="/workspace", tags=["Workspace"])


@router.post("/connect", response_model=WorkspaceInfo)
async def connect_repo(req: ConnectRepoRequest, org: OrganizationOut = Depends(get_current_org)):
    """Clone a GitHub repo (shallow) and return workspace_id + file tree."""
    try:
        result = await workspace_service.connect_repo(
            org.id,
            repo_url=req.github_url,
            branch=req.branch,
            pat=req.pat,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{workspace_id}/tree")
async def get_tree(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    """Return the current file tree for the workspace."""
    try:
        tree = workspace_service.get_file_tree(org.id, workspace_id)
        return {"workspace_id": workspace_id, "tree": tree}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{workspace_id}/file", response_model=FileContentResponse)
async def get_file(workspace_id: str, path: str, org: OrganizationOut = Depends(get_current_org)):
    """Return content of a single file."""
    try:
        return workspace_service.get_file_content(org.id, workspace_id, path)
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{workspace_id}/file")
async def save_file(workspace_id: str, path: str, req: SaveFileRequest, org: OrganizationOut = Depends(get_current_org)):
    """Save file content locally (does not commit)."""
    try:
        workspace_service.save_file_content(org.id, workspace_id, path, req.content)
        return {"status": "saved", "path": path}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{workspace_id}")
async def delete_workspace(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    """Clean up cloned repo directory."""
    try:
        workspace_service.delete_workspace(org.id, workspace_id)
        return {"status": "deleted", "workspace_id": workspace_id}
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
