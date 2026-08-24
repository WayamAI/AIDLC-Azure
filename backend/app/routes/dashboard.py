from fastapi import APIRouter, HTTPException, Depends
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    try:
        return await dashboard_service.get_stats(db, org.id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
