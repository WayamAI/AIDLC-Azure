"""Git operation routes status, log, branch, commit+push, diff."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    CommitRequest, CommitResponse,
    BranchRequest, GitStatusResponse,
)
from app.services import git_service
from app.services.git_service import WorkspaceNotFound

router = APIRouter(prefix="/git", tags=["Git Operations"])


@router.get("/status", response_model=GitStatusResponse)
async def git_status(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    try:
        return await git_service.get_status(org.id, workspace_id)
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/log")
async def git_log(
    workspace_id: str,
    max_count: int = 20,
    org: OrganizationOut = Depends(get_current_org),
):
    try:
        entries = await git_service.get_log(org.id, workspace_id, max_count)
        return {"workspace_id": workspace_id, "commits": entries}
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/diff")
async def git_diff(workspace_id: str, file_path: str, org: OrganizationOut = Depends(get_current_org)):
    try:
        diff = await git_service.get_file_diff(org.id, workspace_id, file_path)
        return {"workspace_id": workspace_id, "file_path": file_path, "diff": diff}
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/branch")
async def create_branch(req: BranchRequest, org: OrganizationOut = Depends(get_current_org)):
    try:
        return await git_service.create_branch(
            org_id=org.id,
            workspace_id=req.workspace_id,
            branch_name=req.branch_name,
            from_branch=req.from_branch,
        )
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/commit", response_model=CommitResponse)
async def commit_and_push(req: CommitRequest, org: OrganizationOut = Depends(get_current_org)):
    """Stage files, commit, and push to GitHub."""
    try:
        return await git_service.commit_and_push(
            org_id=org.id,
            workspace_id=req.workspace_id,
            branch=req.branch,
            files=req.files,
            message=req.message,
            new_file_contents=req.new_file_contents,
            author_name=req.author_name,
            author_email=req.author_email,
        )
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
