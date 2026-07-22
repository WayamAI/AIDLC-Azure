"""Commit routes impact tree for root-to-leaf dependency view."""
from fastapi import APIRouter, HTTPException

from app.services import impact_service

router = APIRouter(prefix="/commit", tags=["Commit"])


@router.get("/impact-tree")
async def get_commit_impact_tree(workspace_id: str, max_depth: int = 4):
    """
    Return commit-stage impact tree where roots are changed files (M/U/A)
    and children follow import/dependency direction.
    """
    try:
        return impact_service.build_workspace_commit_impact_tree(
            workspace_id=workspace_id,
            max_depth=max_depth,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
