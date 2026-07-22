from fastapi import APIRouter, Query
from app.database import get_db

router = APIRouter(prefix="/cost-logs", tags=["Cost Logs"])


@router.get("")
async def get_cost_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
):
    db = get_db()
    col = db["api_cost_logs"]

    total = await col.count_documents({})
    skip = (page - 1) * limit
    cursor = col.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    logs = await cursor.to_list(length=limit)

    # Serialize datetime fields
    for log in logs:
        if "created_at" in log and hasattr(log["created_at"], "isoformat"):
            log["created_at"] = log["created_at"].isoformat().replace("+00:00", "Z")

    total_pages = max(1, (total + limit - 1) // limit)

    pipeline = [{"$group": {"_id": None, "grand_total": {"$sum": "$total_cost_usd"}}}]
    agg = await col.aggregate(pipeline).to_list(length=1)
    grand_total = round(agg[0]["grand_total"], 4) if agg else 0.0

    return {
        "logs": logs,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "grand_total_cost_usd": grand_total,
    }
