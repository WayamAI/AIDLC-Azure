from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.test_case import TestCaseUpdate
from app.models.organization import OrganizationOut
from app.services import test_case_service

router = APIRouter(prefix="/test-cases", tags=["Test Cases"])


@router.get("")
async def get_test_cases(
    requirement_id: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    cases = await test_case_service.get_test_cases(
        db,
        org.id,
        requirement_id=requirement_id,
        category=category,
        skip=skip,
        limit=limit,
    )
    return cases


@router.get("/grouped")
async def get_grouped(
    requirement_id: Optional[str] = Query(default=None),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Returns test cases grouped by category mirrors frontend mockTestCases shape."""
    return await test_case_service.get_grouped_test_cases(db, org.id, requirement_id=requirement_id)


@router.get("/{tc_id}")
async def get_test_case(
    tc_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    tc = await test_case_service.get_test_case_by_id(db, org.id, tc_id)
    if not tc:
        raise HTTPException(status_code=404, detail=f"Test case {tc_id} not found")
    return tc


@router.put("/{tc_id}")
async def update_test_case(
    tc_id: str,
    tc_update: TestCaseUpdate,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    update_data = {k: v for k, v in tc_update.model_dump().items() if v is not None}
    updated_tc = await test_case_service.update_test_case(db, org.id, tc_id, update_data)
    if not updated_tc:
        raise HTTPException(status_code=404, detail=f"Test case {tc_id} not found")
    return updated_tc
