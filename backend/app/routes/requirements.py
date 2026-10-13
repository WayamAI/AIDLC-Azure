from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.requirement import RequirementCreate
from app.models.organization import OrganizationOut
from app.services import requirement_service

router = APIRouter(prefix="/requirements", tags=["Requirements"])


@router.post("", status_code=201)
async def analyze_requirement(
    body: RequirementCreate,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    result = await requirement_service.create_requirement(db, org.id, body.text, body.instructions)
    return result


@router.get("")
async def list_requirements(
    skip: int = 0,
    limit: int = 20,
    status: str = "processed",
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Processed requirements by default; `status=failed|pending`, or `status=all` for every one."""
    return await requirement_service.list_requirements(
        db, org.id, skip=skip, limit=limit, status=None if status == "all" else status,
    )
