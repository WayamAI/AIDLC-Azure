from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.models.test_case import TestCaseUpdate
from app.services import test_case_service

router = APIRouter(prefix="/test-cases", tags=["Test Cases"])


@router.get("")
async def get_test_cases(
    requirement_id: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    skip: int = 0,
    limit: int = 100,
):
    cases = await test_case_service.get_test_cases(
        requirement_id=requirement_id,
        category=category,
        skip=skip,
        limit=limit,
    )
    return cases


@router.get("/grouped")
async def get_grouped(requirement_id: Optional[str] = Query(default=None)):
    """Returns test cases grouped by category mirrors frontend mockTestCases shape."""
    return await test_case_service.get_grouped_test_cases(requirement_id=requirement_id)


@router.get("/{tc_id}")
async def get_test_case(tc_id: str):
    tc = await test_case_service.get_test_case_by_id(tc_id)
    if not tc:
        raise HTTPException(status_code=404, detail=f"Test case {tc_id} not found")
    return tc


@router.put("/{tc_id}")
async def update_test_case(tc_id: str, tc_update: TestCaseUpdate):
    update_data = {k: v for k, v in tc_update.model_dump().items() if v is not None}
    updated_tc = await test_case_service.update_test_case(tc_id, update_data)
    if not updated_tc:
        raise HTTPException(status_code=404, detail=f"Test case {tc_id} not found")
    return updated_tc
