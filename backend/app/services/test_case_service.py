"""
Test-case service: CRUD + bulk insert from AI output.
"""
from datetime import datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.models.test_case import TestCaseOut


async def create_test_cases_from_ai(db, org_id: str, requirement_id: str, ai_data: dict[str, list[dict[str, Any]]]) -> int:
    docs = []
    for category, tests in ai_data.items():
        for t in tests:
            docs.append({
                "org_id": org_id,
                "requirement_id": requirement_id,
                "tc_id": t.get("tc_id", ""),
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "severity": t.get("severity", "Medium"),
                "expected": t.get("expected", ""),
                "category": category,
                "created_at": datetime.utcnow(),
            })
    if docs:
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
