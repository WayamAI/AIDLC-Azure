"""Coverage routes AST-based gap analysis."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.workspace_models import CoverageAnalyzeRequest, CoverageAnalyzeResponse
from app.routes.deps import attach_workspace
from app.services import coverage_service
from app.services.git_service import safe_error_text

log = logging.getLogger(__name__)

router = APIRouter(prefix="/coverage", tags=["Coverage"], dependencies=[Depends(attach_workspace)])


@router.post("/analyze", response_model=CoverageAnalyzeResponse)
async def analyze_coverage(req: CoverageAnalyzeRequest, org: OrganizationOut = Depends(get_current_org)):
    """Parse file with AST and cross-reference test files to find coverage gaps."""
    try:
        result = await asyncio.to_thread(
            coverage_service.analyze_coverage,
            workspace_id=req.workspace_id,
            file_path=req.file_path,
            content=req.content,
            org_id=org.id,
        )
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=safe_error_text(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_text(exc))
    except Exception:
        log.exception("Coverage analysis failed for %s", req.file_path)
        raise HTTPException(status_code=500, detail="Coverage analysis failed. Check the server log.")
