"""
Requirements service: persists requirements and triggers test-case generation.
"""
from datetime import datetime
from bson import ObjectId

from app.database import get_db
from app.models.requirement import RequirementOut
from app.services import ai_service
from app.services.test_case_service import create_test_cases_from_ai


async def create_requirement(text: str, instructions: str = None) -> dict:
    db = get_db()

    # Insert requirement
    req_doc = {
        "text": text,
        "created_at": datetime.utcnow(),
        "status": "pending",
    }
    result = await db.requirements.insert_one(req_doc)
    req_id = str(result.inserted_id)

    # Generate tests via Gemini
    ai_data = await ai_service.generate_test_cases(text, instructions)

    # Persist test cases
    await create_test_cases_from_ai(req_id, ai_data)

    # Mark requirement as processed
    await db.requirements.update_one(
        {"_id": ObjectId(req_id)},
        {"$set": {"status": "processed"}},
    )

    return {
        "id": req_id,
        "text": text,
        "status": "processed",
        "test_case_categories": {k: len(v) for k, v in ai_data.items()},
        "total_tests": sum(len(v) for v in ai_data.values()),
    }


async def list_requirements(skip: int = 0, limit: int = 20) -> list[RequirementOut]:
    db = get_db()
    cursor = db.requirements.find().skip(skip).limit(limit).sort("created_at", -1)
    docs = await cursor.to_list(length=limit)
    return [
        RequirementOut(
            id=str(d["_id"]),
            text=d["text"],
            created_at=d["created_at"],
            status=d["status"],
        )
        for d in docs
    ]
