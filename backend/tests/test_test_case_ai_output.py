"""AI test cases with missing content must not be stored, and must not mark a requirement processed."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services import ai_service, organization_service, requirement_service
from app.services.test_case_service import create_test_cases_from_ai


async def test_only_complete_items_are_stored(db):
    ai_data = {
        "functional": [
            {"tc_id": "TC-001", "name": "Login works", "severity": "high",
             "expected": "Dashboard is shown", "description": "d"},
            "not an object",
            {"tc_id": "TC-002", "name": "   ", "severity": "High", "expected": "x"},
            {"tc_id": "TC-003", "name": "No expected", "severity": "High", "expected": ""},
            {"tc_id": "TC-004", "name": "Missing expected key", "severity": "Low"},
            {"tc_id": "TC-005", "name": "Unknown severity", "severity": "urgent", "expected": "x"},
            {"tc_id": "TC-006", "name": "No severity", "expected": "x"},
        ],
        "edge": "not a list",
    }

    stored = await create_test_cases_from_ai(db, "org_a", "req_1", ai_data)

    assert stored == 1
    docs = await db.test_cases.find({}).to_list(length=100)
    assert [d["name"] for d in docs] == ["Login works"]
    assert docs[0]["severity"] == "High"
    assert docs[0]["expected"] == "Dashboard is shown"
    assert docs[0]["category"] == "functional"


async def test_no_usable_items_raises_and_stores_nothing(db):
    with pytest.raises(ai_service.AIResponseError):
        await create_test_cases_from_ai(
            db, "org_a", "req_1", {"functional": [{"name": "x", "expected": ""}, None]}
        )
    assert await db.test_cases.count_documents({}) == 0


async def test_requirement_with_no_usable_cases_is_not_marked_processed(db):
    org = await organization_service.create_organization(db, workos_org_id="org_req", name="req")
    empty = {"functional": [{"tc_id": "TC-001", "name": "Nameless", "severity": "High", "expected": ""}]}

    with patch.object(ai_service, "generate_test_cases", AsyncMock(return_value=empty)):
        with pytest.raises(ai_service.AIResponseError):
            await requirement_service.create_requirement(db, org.id, "Users can log in")

    req = await db.requirements.find_one({"org_id": org.id})
    assert req["status"] == "failed"
    assert await db.test_cases.count_documents({}) == 0
