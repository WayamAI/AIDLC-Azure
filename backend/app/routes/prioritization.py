from fastapi import APIRouter, HTTPException, Query, Depends
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import prioritization_service

router = APIRouter(prefix="/prioritization", tags=["Prioritization"])


@router.get("")
async def get_prioritized_tests(
    refresh: bool = Query(default=False),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Returns AI-ranked test list by risk/failure history.
    Pass ?refresh=true to re-rank using latest results.
    """
    try:
        return await prioritization_service.get_prioritized_tests(db, org.id, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
