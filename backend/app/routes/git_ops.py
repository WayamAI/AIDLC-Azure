"""Git operation routes status, log, branch, commit+push, diff."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    CommitRequest, CommitResponse,
    BranchRequest, GitStatusResponse,
)
from app.routes.deps import attach_workspace
from app.services import git_service
from app.services.git_service import WorkspaceNotFound

router = APIRouter(prefix="/git", tags=["Git Operations"], dependencies=[Depends(attach_workspace)])


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
        # str(exc) of a git failure can carry the command line, a token in a URL or
        # the server's clone path: return the scrubbed text only.
        raise HTTPException(status_code=400, detail=git_service.safe_error_text(exc))


class PushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: str
    branch: Optional[str] = None  # default: the workspace's checked-out branch


class PushResponse(BaseModel):
    workspace_id: str
    branch: str
    sha: str            # tip of the branch that is now on the remote
    github_url: str
    pushed: bool        # True when commits were sent by this call
    up_to_date: bool    # True when the remote already had them (nothing to push)
    message: str


@router.post("/push", response_model=PushResponse)
async def push(req: PushRequest, org: OrganizationOut = Depends(get_current_org)):
    """Push the workspace's existing commits. Creates no commit; used to retry a failed push."""
    try:
        return await git_service.push_branch(org.id, req.workspace_id, req.branch)
    except WorkspaceNotFound:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except git_service.PushError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
