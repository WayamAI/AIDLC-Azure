"""
Dashboard aggregation service.
"""
from datetime import datetime, timezone

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
    latest_run = await db.test_results.find_one(
        {"org_id": org_id}, sort=[("timestamp", -1)]
    )
    run_id = latest_run["run_id"] if latest_run else None

    passed = failed = 0
    avg_duration = 0.0
    total_duration = 0.0
    results_count = 0

    if run_id:
        run_cursor = db.test_results.find({"run_id": run_id, "org_id": org_id})
        run_docs = await run_cursor.to_list(length=1000)
        passed = sum(1 for d in run_docs if d["status"] == "PASS")
        failed = sum(1 for d in run_docs if d["status"] == "FAIL")
        results_count = len(run_docs)
        total_duration = round(sum(d["duration"] for d in run_docs), 2)
        avg_duration = round(total_duration / results_count, 2) if results_count else 0.0

    success_rate = round(passed / results_count * 100, 1) if results_count else 0.0

    # Priority counts
    high_priority = await db.prioritized_tests.count_documents({"org_id": org_id, "priority": {"$gte": 80}})
    known_failures = await db.prioritized_tests.count_documents({"org_id": org_id, "known_failure": True})

    # Active vehicles NOTE: `synthetic_data` is pre-existing fixture/demo data with
    # no owning route and no org_id field in this codebase (distinct from the
    # `synthetic_datasets` collection, which IS org-scoped). Left unfiltered.
    active_vehicles = await db.synthetic_data.count_documents({"status": "Active"})

    # Weekly trend (last 7 runs, 1 per day aggregated)
    weekly_pipeline = [
        {"$match": {"org_id": org_id}},
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
        {"$sort": {"_id": 1}},
        {"$limit": 7},
    ]
    weekly_raw = await db.test_results.aggregate(weekly_pipeline).to_list(length=7)
    weekly_trend = [
        {
            "day": _day_label(r["_id"]),
            "passed": r["passed"],
            "failed": r["failed"],
            "total": r["total"],
        }
        for r in weekly_raw
    ]

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
        db.test_results.find({"org_id": org_id}).sort("timestamp", -1).limit(12)
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
        "active_vehicles": active_vehicles,
        "weekly_trend": weekly_trend,
        "severity_breakdown": severity_breakdown,
        "recent_activity": recent_activity,
    }
