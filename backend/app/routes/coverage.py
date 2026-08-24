"""Coverage routes AST-based gap analysis."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.workspace_models import CoverageAnalyzeRequest, CoverageAnalyzeResponse
from app.services import coverage_service

router = APIRouter(prefix="/coverage", tags=["Coverage"])


@router.post("/analyze", response_model=CoverageAnalyzeResponse)
async def analyze_coverage(req: CoverageAnalyzeRequest, org: OrganizationOut = Depends(get_current_org)):
    """Parse file with AST and cross-reference test files to find coverage gaps."""
    try:
        result = coverage_service.analyze_coverage(
            workspace_id=req.workspace_id,
            file_path=req.file_path,
            content=req.content,
        )
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
