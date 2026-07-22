from fastapi import APIRouter, HTTPException
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def get_dashboard_stats():
    try:
        return await dashboard_service.get_stats()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
