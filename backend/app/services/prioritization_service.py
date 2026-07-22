"""
Prioritization service: uses Gemini to rank test cases by risk/failure history.
"""
from typing import Any

from app.database import get_db
from app.models.prioritization import PrioritizedTestOut
from app.services import ai_service


async def get_prioritized_tests(refresh: bool = False) -> list[PrioritizedTestOut]:
    db = get_db()

    # Return cached prioritization unless caller wants a fresh ranking
    if not refresh:
        cursor = db.prioritized_tests.find().sort("priority", -1).limit(50)
        cached = await cursor.to_list(length=50)
        if cached:
            return [_to_out(d) for d in cached]

    # Build summary from test_results collection
    pipeline = [
        {
            "$group": {
                "_id": "$tc_id",
                "name": {"$last": "$name"},
                "failure_count": {"$sum": {"$cond": [{"$eq": ["$status", "FAIL"]}, 1, 0]}},
                "total": {"$sum": 1},
                "last_status": {"$last": "$status"},
            }
        }
    ]
    agg = await db.test_results.aggregate(pipeline).to_list(length=500)

    if not agg:
        return []

    summary: list[dict[str, Any]] = [
        {
            "tc_id": r["_id"],
            "name": r["name"],
            "failure_count": r["failure_count"],
            "total_runs": r["total"],
            "last_status": r["last_status"],
        }
        for r in agg
    ]

    # Ask Gemini to rank
    ranked = await ai_service.prioritize_tests(summary)

    # Upsert into mongo
    for item in ranked:
        await db.prioritized_tests.update_one(
            {"tc_id": item["tc_id"]},
            {
                "$set": {
                    "tc_id": item["tc_id"],
                    "name": item.get("name", ""),
                    "priority": item.get("priority", 0),
                    "status": item.get("status", "stable"),
                    "known_failure": item.get("known_failure", False),
                    "failure_count": item.get("failure_count", 0),
                    "severity": item.get("severity", "Medium"),
                }
            },
            upsert=True,
        )

    cursor = db.prioritized_tests.find().sort("priority", -1).limit(50)
    docs = await cursor.to_list(length=50)
    return [_to_out(d) for d in docs]


def _to_out(doc: dict) -> PrioritizedTestOut:
    return PrioritizedTestOut(
        id=str(doc["_id"]),
        tc_id=doc["tc_id"],
        name=doc["name"],
        failure_count=doc.get("failure_count", 0),
        severity=doc.get("severity", "Medium"),
        priority=doc.get("priority", 0),
        status=doc.get("status", "stable"),
        known_failure=doc.get("known_failure", False),
    )
