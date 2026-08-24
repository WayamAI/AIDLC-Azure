from fastapi import APIRouter, HTTPException, Depends
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.requirement import RequirementCreate
from app.models.organization import OrganizationOut
from app.services import requirement_service
from app.services.ai_service import AIQuotaError

router = APIRouter(prefix="/requirements", tags=["Requirements"])


@router.post("", status_code=201)
async def analyze_requirement(
    body: RequirementCreate,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    try:
        result = await requirement_service.create_requirement(db, org.id, body.text, body.instructions)
        return result
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("")
async def list_requirements(
    skip: int = 0,
    limit: int = 20,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    return await requirement_service.list_requirements(db, org.id, skip=skip, limit=limit)
