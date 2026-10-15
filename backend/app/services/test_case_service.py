"""
Test-case service: CRUD + bulk insert from AI output.
"""
from datetime import datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.models.test_case import TestCaseOut
from app.services.ai_service import AIResponseError

# The allowed TestCase severities (app/models/test_case.py), keyed by lower-case input.
_SEVERITIES = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}


async def create_test_cases_from_ai(db, org_id: str, requirement_id: str, ai_data: dict[str, list[dict[str, Any]]]) -> int:
    """Persist the AI's test cases and return how many were stored.

    Items that are not objects, lack a non-empty name or expected result, or have a
    severity outside the allowed set are skipped. Raises AIResponseError when no
    usable item remains, so the requirement is not marked processed.
    """
    docs = []
    for category, tests in ai_data.items():
        if not isinstance(tests, list):
            continue
        for t in tests:
            if not isinstance(t, dict):
                continue
            name = t.get("name")
            expected = t.get("expected")
            if not isinstance(name, str) or not name.strip():
                continue
            if not isinstance(expected, str) or not expected.strip():
                continue
            severity = _SEVERITIES.get(str(t.get("severity") or "").strip().lower())
            if severity is None:
                continue
            docs.append({
                "org_id": org_id,
                "requirement_id": requirement_id,
                "tc_id": str(t.get("tc_id") or ""),
                "name": name.strip(),
                "description": str(t.get("description") or ""),
                "severity": severity,
                "expected": expected.strip(),
                "category": category,
                "created_at": datetime.utcnow(),
            })
    if not docs:
        raise AIResponseError("The AI model returned no usable test cases. Please try again.")
    await db.test_cases.insert_many(docs)
    return len(docs)


async def get_test_cases(
    db,
    org_id: str,
    requirement_id: str | None = None,
    category: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[TestCaseOut]:
    query: dict[str, Any] = {"org_id": org_id}
    if requirement_id:
        query["requirement_id"] = requirement_id
    if category:
        query["category"] = category

    cursor = db.test_cases.find(query).skip(skip).limit(limit).sort("tc_id", 1)
    docs = await cursor.to_list(length=limit)
    return [_to_out(d) for d in docs]


def _id_query(org_id: str, case_id: str) -> dict[str, Any] | None:
    """Query for one case by Mongo _id within an org; None if the id is malformed.

    tc_id restarts at TC-001 for every requirement, so it cannot identify a case.
    """
    try:
        return {"_id": ObjectId(case_id), "org_id": org_id}
    except (InvalidId, TypeError):
        return None


async def get_test_case_by_id(db, org_id: str, case_id: str) -> TestCaseOut | None:
    query = _id_query(org_id, case_id)
    if query is None:
        return None
    doc = await db.test_cases.find_one(query)
    return _to_out(doc) if doc else None


async def get_grouped_test_cases(db, org_id: str, requirement_id: str | None = None) -> dict[str, list[dict]]:
    """Returns test cases grouped by category – mirrors mockTestCases shape."""
    tests = await get_test_cases(db, org_id, requirement_id=requirement_id)
    grouped: dict[str, list[dict]] = {
        "functional": [], "edge": [], "api": [], "failure": [], "regression": []
    }
    for t in tests:
        cat = t.category if t.category in grouped else "functional"
        grouped[cat].append(t.model_dump())
    return grouped


def _to_out(doc: dict) -> TestCaseOut:
    return TestCaseOut(
        id=str(doc["_id"]),
        requirement_id=doc["requirement_id"],
        tc_id=doc["tc_id"],
        name=doc["name"],
        description=doc["description"],
        severity=doc["severity"],
        expected=doc["expected"],
        category=doc["category"],
        created_at=doc["created_at"],
    )

async def update_test_case(db, org_id: str, case_id: str, update_data: dict[str, Any]) -> TestCaseOut | None:
    if not update_data:
        return await get_test_case_by_id(db, org_id, case_id)

    query = _id_query(org_id, case_id)
    if query is None:
        return None
    result = await db.test_cases.find_one_and_update(
        query,
        {"$set": update_data},
        return_document=True
    )
    return _to_out(result) if result else None
