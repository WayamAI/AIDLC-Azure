from fastapi import APIRouter, HTTPException, Query
from app.services import prioritization_service

router = APIRouter(prefix="/prioritization", tags=["Prioritization"])


@router.get("")
async def get_prioritized_tests(refresh: bool = Query(default=False)):
    """
    Returns AI-ranked test list by risk/failure history.
    Pass ?refresh=true to re-rank using latest results.
    """
    try:
        return await prioritization_service.get_prioritized_tests(refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
