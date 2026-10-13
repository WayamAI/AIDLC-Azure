"""
Risk ranking: orders test cases by measured failure history and severity.

The score is computed, not generated. Inputs are real browser results written by
execution_service; rows from before real execution existed are ignored.

  score = severity weight x (60% recent failure rate + 40% if the last run failed)

Cases that have never been executed (only skipped) get a smaller fixed share of
their severity weight, because an unverified critical path is still a risk.
"""
from typing import Any

from app.models.prioritization import PrioritizedTestOut

_SEVERITY_WEIGHT = {"critical": 1.0, "high": 0.75, "medium": 0.5, "low": 0.25}
_LOOKBACK = 10
_UNVERIFIED_SHARE = 0.3


def score_case(severity: str, statuses: list[str]) -> tuple[int, str, bool, str]:
    """statuses are newest first. Returns (priority 0-100, status, known_failure, reason)."""
    weight = _SEVERITY_WEIGHT.get((severity or "").lower(), 0.5)
    executed = [s for s in statuses if s in ("PASS", "FAIL")][:_LOOKBACK]

    if not executed:
        return round(100 * weight * _UNVERIFIED_SHARE), "warning", False, "Never verified; every run skipped it"

    failures = executed.count("FAIL")
    last_failed = executed[0] == "FAIL"
    rate = failures / len(executed)
    priority = round(100 * weight * (0.6 * rate + (0.4 if last_failed else 0.0)))
    known_failure = len(executed) >= 2 and executed[0] == executed[1] == "FAIL"

    if last_failed:
        status = "failed"
    elif failures:
        status = "warning"
    else:
        status = "stable"

    runs = f"{len(executed)} run" + ("s" if len(executed) != 1 else "")
    if failures:
        reason = f"Failed {failures} of last {runs}" + ("; failing now" if last_failed else "; passing now")
    else:
        reason = f"Passed all of last {runs}"
    return priority, status, known_failure, reason


async def get_prioritized_tests(db, org_id: str, refresh: bool = False) -> list[PrioritizedTestOut]:
    # `refresh` is accepted for API compatibility; the ranking is always computed from current results.
    pipeline = [
        {"$match": {"org_id": org_id, "test_case_id": {"$exists": True}}},
        {"$sort": {"timestamp": -1}},
        {
            "$group": {
                "_id": "$test_case_id",
                "tc_id": {"$first": "$tc_id"},
                "name": {"$first": "$name"},
                "severity": {"$first": "$severity"},
                "statuses": {"$push": "$status"},
                "last_error": {"$first": "$error_message"},
            }
        },
    ]
    rows: list[dict[str, Any]] = await db.test_results.aggregate(pipeline).to_list(length=1000)

    out: list[PrioritizedTestOut] = []
    for r in rows:
        priority, status, known_failure, reason = score_case(r.get("severity") or "Medium", r["statuses"])
        executed = [s for s in r["statuses"] if s in ("PASS", "FAIL")][:_LOOKBACK]
        out.append(
            PrioritizedTestOut(
                id=str(r["_id"]),
                tc_id=r["tc_id"],
                name=r["name"],
                failure_count=executed.count("FAIL"),
                total_runs=len(executed),
                severity=r.get("severity") or "Medium",
                priority=priority,
                status=status,
                known_failure=known_failure,
                reason=reason,
                # The full browser call log lives on the run result; the ranking shows the headline.
                last_error=(r.get("last_error") or "").strip().splitlines()[0][:200] if status == "failed" and r.get("last_error") else None,
            )
        )
    out.sort(key=lambda t: (-t.priority, t.tc_id))
    return out
