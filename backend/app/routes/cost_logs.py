from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Depends
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut

router = APIRouter(prefix="/cost-logs", tags=["Cost Logs"])

# The provider is not billed per token, so the stored *_cost_usd fields are
# always zero. They are not returned; usage is reported as calls and tokens.
_LOG_PROJECTION = {"_id": 0, "input_cost_usd": 0, "output_cost_usd": 0, "total_cost_usd": 0}

_USAGE_SUMS = {
    "calls": {"$sum": 1},
    "prompt_tokens": {"$sum": {"$ifNull": ["$prompt_tokens", 0]}},
    "completion_tokens": {"$sum": {"$ifNull": ["$completion_tokens", 0]}},
    "total_tokens": {"$sum": {"$ifNull": ["$total_tokens", 0]}},
    # Calls the provider returned no token usage for (logged with zero tokens).
    "calls_without_usage": {
        "$sum": {"$cond": [{"$gt": [{"$ifNull": ["$total_tokens", 0]}, 0]}, 0, 1]}
    },
}
_USAGE_FIELDS = tuple(_USAGE_SUMS)


def _usage_row(doc: dict | None) -> dict:
    return {field: int((doc or {}).get(field) or 0) for field in _USAGE_FIELDS}


@router.get("")
async def get_cost_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    col = db["api_cost_logs"]
    query = {"org_id": org.id}

    total = await col.count_documents(query)
    skip = (page - 1) * limit
    cursor = col.find(query, _LOG_PROJECTION).sort("created_at", -1).skip(skip).limit(limit)
    logs = await cursor.to_list(length=limit)

    # Serialize datetime fields
    for log in logs:
        if "created_at" in log and hasattr(log["created_at"], "isoformat"):
            log["created_at"] = log["created_at"].isoformat().replace("+00:00", "Z")

    total_pages = max(1, (total + limit - 1) // limit)

    return {
        "logs": logs,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    }


@router.get("/summary")
async def get_usage_summary(
    days: int = Query(30, ge=1, le=365),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """AI usage for the org over the last `days` days (UTC): totals, per task, per day."""
    col = db["api_cost_logs"]
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    # created_at is stored as naive UTC by the driver.
    match = {"org_id": org.id, "created_at": {"$gte": since.replace(tzinfo=None)}}

    totals = await col.aggregate([
        {"$match": match},
        {"$group": {"_id": None, **_USAGE_SUMS}},
    ]).to_list(length=1)

    by_task = await col.aggregate([
        {"$match": match},
        {"$group": {"_id": "$task_name", **_USAGE_SUMS}},
        {"$sort": {"total_tokens": -1, "calls": -1}},
    ]).to_list(length=None)

    by_day = await col.aggregate([
        {"$match": match},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            **_USAGE_SUMS,
        }},
        {"$sort": {"_id": 1}},
    ]).to_list(length=None)

    # Days with no calls are returned as zero rows so the series is continuous.
    day_rows = {d["_id"]: d for d in by_day}
    series = []
    for offset in range(days):
        date = (since + timedelta(days=offset)).strftime("%Y-%m-%d")
        series.append({"date": date, **_usage_row(day_rows.get(date))})

    return {
        "days": days,
        "since": since.isoformat().replace("+00:00", "Z"),
        "totals": _usage_row(totals[0] if totals else None),
        "by_task": [{"task_name": d["_id"] or "Unlabelled", **_usage_row(d)} for d in by_task],
        "by_day": series,
    }
