"""
Dashboard aggregation service.
"""
from app.database import get_db


async def get_stats() -> dict:
    db = get_db()

    # Test case counts by category
    tc_pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}}
    ]
    tc_agg = await db.test_cases.aggregate(tc_pipeline).to_list(length=10)
    test_case_counts = {r["_id"]: r["count"] for r in tc_agg}
    total_tests = sum(test_case_counts.values())

    # Latest run results
    latest_run = await db.test_results.find_one(
        {}, sort=[("timestamp", -1)]
    )
    run_id = latest_run["run_id"] if latest_run else None

    passed = failed = 0
    avg_duration = 0.0
    total_duration = 0.0
    results_count = 0

    if run_id:
        run_cursor = db.test_results.find({"run_id": run_id})
        run_docs = await run_cursor.to_list(length=1000)
        passed = sum(1 for d in run_docs if d["status"] == "PASS")
        failed = sum(1 for d in run_docs if d["status"] == "FAIL")
        results_count = len(run_docs)
        total_duration = round(sum(d["duration"] for d in run_docs), 2)
        avg_duration = round(total_duration / results_count, 2) if results_count else 0.0

    success_rate = round(passed / results_count * 100, 1) if results_count else 0.0

    # Priority counts
    high_priority = await db.prioritized_tests.count_documents({"priority": {"$gte": 80}})
    known_failures = await db.prioritized_tests.count_documents({"known_failure": True})

    # Active vehicles
    active_vehicles = await db.synthetic_data.count_documents({"status": "Active"})

    # Weekly trend (last 7 runs, 1 per day aggregated)
    weekly_pipeline = [
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
            "day": r["_id"],
            "passed": r["passed"],
            "failed": r["failed"],
            "total": r["total"],
        }
        for r in weekly_raw
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
    }
