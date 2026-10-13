"""
Dashboard aggregation service.
"""
from datetime import datetime, timedelta, timezone

from app.services import prioritization_service

_SEVERITY_ORDER = ("Critical", "High", "Medium", "Low")


def _time_ago(ts) -> str:
    if ts is None:
        return ""
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return ""
    if getattr(ts, "tzinfo", None) is None:
        ts = ts.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - ts
    secs = max(0, int(delta.total_seconds()))
    if secs < 60:
        return "just now"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


def _day_label(iso_date: str) -> str:
    try:
        return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%a")
    except ValueError:
        return iso_date


def _iso_timestamp(ts) -> str:
    if ts is None:
        return ""
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)


async def get_stats(db, org_id: str) -> dict:
    # Test case counts by category
    tc_pipeline = [
        {"$match": {"org_id": org_id}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]
    tc_agg = await db.test_cases.aggregate(tc_pipeline).to_list(length=10)
    test_case_counts = {r["_id"]: r["count"] for r in tc_agg}
    total_tests = sum(test_case_counts.values())

    # Latest run results
    real = {"org_id": org_id, "test_case_id": {"$exists": True}}
    latest_run = await db.test_results.find_one(real, sort=[("timestamp", -1)])
    run_id = latest_run["run_id"] if latest_run else None

    passed = failed = 0
    avg_duration: float | None = None
    total_duration = 0.0
    results_count = 0

    if run_id:
        run_cursor = db.test_results.find({**real, "run_id": run_id})
        run_docs = await run_cursor.to_list(length=1000)
        passed = sum(1 for d in run_docs if d["status"] == "PASS")
        failed = sum(1 for d in run_docs if d["status"] == "FAIL")
        # Skipped cases were never checked, so they stay out of the rate and the timings.
        results_count = passed + failed
        total_duration = round(sum(d["duration"] for d in run_docs if d["status"] != "SKIP"), 2)
        avg_duration = round(total_duration / results_count, 2) if results_count else None

    # No executed case (no run yet, or every case skipped) means no rate, not 0%.
    success_rate = round(passed / results_count * 100, 1) if results_count else None

    # Priority counts come from the same computed ranking the Risk Ranking page shows.
    ranked = await prioritization_service.get_prioritized_tests(db, org_id)
    high_priority = sum(1 for t in ranked if t.priority >= 60)
    known_failures = sum(1 for t in ranked if t.known_failure)

    synthetic_datasets = await db.synthetic_datasets.count_documents({"org_id": org_id})

    # Weekly trend: the seven calendar days (UTC) ending today, one entry per day.
    # A day with no executed results is a real zero and is kept, so the chart always
    # has seven positions and a single active day is still readable.
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    window_start = today - timedelta(days=6)
    weekly_pipeline = [
        {"$match": {**real, "status": {"$ne": "SKIP"}, "timestamp": {"$gte": window_start}}},
        {
            "$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}
                },
                "passed": {"$sum": {"$cond": [{"$eq": ["$status", "PASS"]}, 1, 0]}},
                "failed": {"$sum": {"$cond": [{"$eq": ["$status", "FAIL"]}, 1, 0]}},
                "total": {"$sum": 1},
            }
        },
    ]
    by_day = {r["_id"]: r for r in await db.test_results.aggregate(weekly_pipeline).to_list(length=14)}
    weekly_trend = []
    for offset in range(7):
        iso = (window_start + timedelta(days=offset)).strftime("%Y-%m-%d")
        row = by_day.get(iso, {})
        weekly_trend.append({
            "day": _day_label(iso),
            "date": iso,
            "passed": row.get("passed", 0),
            "failed": row.get("failed", 0),
            "total": row.get("total", 0),
        })

    sev_pipeline = [
        {"$match": {"org_id": org_id}},
        {"$group": {"_id": "$severity", "count": {"$sum": 1}}},
    ]
    sev_agg = await db.test_cases.aggregate(sev_pipeline).to_list(length=20)
    sev_counts = {name: 0 for name in _SEVERITY_ORDER}
    for row in sev_agg:
        label = str(row.get("_id") or "Medium").strip().title()
        if label in sev_counts:
            sev_counts[label] += int(row.get("count") or 0)
    severity_breakdown = [
        {"severity": name, "count": sev_counts[name]} for name in _SEVERITY_ORDER
    ]

    recent_docs = await (
        db.test_results.find(real).sort("timestamp", -1).limit(12)
    ).to_list(length=12)
    recent_activity = [
        {
            "id": d.get("tc_id") or str(d.get("_id", "")),
            "name": d.get("name") or d.get("tc_id") or "Test",
            "status": d.get("status") or "FAIL",
            "timestamp": _iso_timestamp(d.get("timestamp")),
            "time_ago": _time_ago(d.get("timestamp")),
        }
        for d in recent_docs
    ]

    return {
        "total_tests": total_tests,
        "test_case_counts": test_case_counts,
        "latest_run": {
            "run_id": run_id,
            "passed": passed,
            "failed": failed,
            "total": results_count,
            "success_rate": success_rate,
            "avg_duration": avg_duration,
            "total_duration": total_duration,
        },
        "high_priority": high_priority,
        "known_failures": known_failures,
        "synthetic_datasets": synthetic_datasets,
        "weekly_trend": weekly_trend,
        "severity_breakdown": severity_breakdown,
        "recent_activity": recent_activity,
    }
