"""
Test execution service: simulates running test cases and stores results.

Pass/fail logic is deterministic and history-aware:
  - Each tc_id has a stable "personality" derived from its ID hash.
  - Severity and category shift the base pass probability.
  - Past failure history (from the DB) makes repeat-flakers stay flaky.
  - Duration is also seeded per test so it doesn't jump wildly between runs.
"""
import asyncio
import hashlib
import random
import uuid
from datetime import datetime
from typing import Any

from app.database import get_db
from app.models.test_execution import RunStarted, RunSummary, TestResultOut
from app.services.test_case_service import get_test_cases


# ── Severity → base pass probability ──────────────────────────────────────
_SEVERITY_PASS_RATE: dict[str, float] = {
    "Critical": 0.68,   # hardest scenarios most likely to surface real bugs
    "High":     0.78,
    "Medium":   0.88,
    "Low":      0.95,
}

# ── Category → adjustment on top of severity ──────────────────────────────
_CATEGORY_DELTA: dict[str, float] = {
    "failure":    -0.22,  # designed to trigger failure paths fails often
    "edge":       -0.12,  # boundary conditions are tricky
    "api":        -0.06,  # network/HTTP layer adds instability
    "functional": +0.00,  # core happy-path neutral
    "regression": +0.05,  # well-understood, stable code paths
}

# ── Category → realistic error messages ───────────────────────────────────
_CATEGORY_ERRORS: dict[str, list[str]] = {
    "failure": [
        "SimulatedFailure: system entered degraded mode as expected",
        "TimeoutError: no ACK received within threshold",
        "ConnectionRefusedError: downstream service unavailable",
        "CircuitBreaker: open state triggered after 3 retries",
    ],
    "edge": [
        "AssertionError: boundary value -1 not handled got IndexError",
        "ValidationError: payload field 'rpm' out of accepted range [0, 9000]",
        "OverflowError: fuel_level=101.3 exceeds max 100.0",
        "AssertionError: empty dataset returned instead of default fallback",
    ],
    "api": [
        "HTTPError 422: missing required field 'vehicle_id' in request body",
        "HTTPError 401: token expired re-authentication required",
        "HTTPError 504: upstream gateway timeout after 30s",
        "AssertionError: response content-type is text/html, expected application/json",
    ],
    "functional": [
        "AssertionError: telemetry interval was 45s, expected ≤30s",
        "AssertionError: stored engine_temp differs from transmitted value by 3.2°",
        "AssertionError: dashboard did not update within 5s of data arrival",
        "AssertionError: GPS coordinates missing from 2 of 10 records",
    ],
    "regression": [
        "AssertionError: v2 response schema missing field 'trip_id' present in v1",
        "AssertionError: pagination broke after refactor page 2 returns page 1 data",
        "AssertionError: legacy fleet_id alias no longer accepted",
        "RegressionError: response time increased from 120ms to 890ms after last deploy",
    ],
}

# ── Duration ranges (seconds) by severity ─────────────────────────────────
_SEVERITY_DURATION: dict[str, tuple[float, float]] = {
    "Critical": (3.5, 9.0),
    "High":     (2.0, 6.0),
    "Medium":   (1.0, 4.0),
    "Low":      (0.3, 2.0),
}


def _tc_seed(tc_id: str) -> int:
    """Return a stable integer seed derived from the test ID.
    This gives every test a fixed 'personality' that survives across runs."""
    return int(hashlib.md5(tc_id.encode()).hexdigest(), 16) % (2 ** 31)


def _pass_probability(tc_id: str, category: str, severity: str, past_fail_rate: float) -> float:
    """
    Combine base severity rate + category delta + history penalty.

    past_fail_rate: fraction of the last N runs where this test failed (0.0–1.0).
    A test that fails 80% of the time historically stays an 80% failure.
    """
    base = _SEVERITY_PASS_RATE.get(severity, 0.85)
    delta = _CATEGORY_DELTA.get(category, 0.0)

    # History weight: blend 40% historical, 60% structural probability
    structural = base + delta
    history_pass = 1.0 - past_fail_rate
    blended = (0.60 * structural) + (0.40 * history_pass)

    # Clamp to [0.05, 0.99] so nothing is ever guaranteed
    return max(0.05, min(0.99, blended))


def _simulate_result(
    tc_id: str,
    name: str,
    severity: str,
    category: str,
    run_id: str,
    past_fail_rate: float,
) -> dict[str, Any]:
    """
    Produce a deterministic-but-varied pass/fail result.

    Seed = tc_id hash XOR run_id hash → same test, different run = different outcome,
    but the test's overall pass rate stays consistent with its history and category.
    """
    tc_seed = _tc_seed(tc_id)
    run_seed = int(hashlib.md5(run_id.encode()).hexdigest(), 16) % (2 ** 31)
    rng = random.Random(tc_seed ^ run_seed)

    pass_prob = _pass_probability(tc_id, category, severity, past_fail_rate)
    status = "PASS" if rng.random() < pass_prob else "FAIL"

    # Duration: seeded by tc_id alone so it's stable per test (only minor run jitter)
    dur_rng = random.Random(tc_seed + (run_seed % 1000))
    lo, hi = _SEVERITY_DURATION.get(severity, (0.5, 5.0))
    duration = round(dur_rng.uniform(lo, hi), 2)

    error = None
    if status == "FAIL":
        err_rng = random.Random(tc_seed ^ run_seed ^ 0xDEAD)
        errors = _CATEGORY_ERRORS.get(category, _CATEGORY_ERRORS["functional"])
        error = err_rng.choice(errors)

    return {
        "tc_id": tc_id,
        "name": name,
        "status": status,
        "duration": duration,
        "error_message": error,
    }


async def _load_past_fail_rates(tc_ids: list[str], lookback: int = 10) -> dict[str, float]:
    """
    For each tc_id, look at the last `lookback` runs and compute what fraction failed.
    Returns a dict tc_id → fail_rate (0.0 = always passed, 1.0 = always failed).
    """
    db = get_db()
    pipeline = [
        {"$match": {"tc_id": {"$in": tc_ids}}},
        {"$sort": {"timestamp": -1}},
        {"$group": {
            "_id": "$tc_id",
            "results": {"$push": "$status"},
        }},
    ]
    cursor = db.test_results.aggregate(pipeline)
    docs = await cursor.to_list(length=len(tc_ids))

    rates: dict[str, float] = {}
    for doc in docs:
        recent = doc["results"][:lookback]
        if recent:
            rates[doc["_id"]] = recent.count("FAIL") / len(recent)
    return rates


async def _execute_run_background(
    run_id: str,
    tests: list[Any],
    data_context: dict[str, Any] | None,
    past_fail_rates: dict[str, float],
) -> None:
    """
    Runs each test case one at a time, sleeping for the test's simulated duration
    so the frontend can poll and see results appearing in real-time.
    Results are written to MongoDB one-by-one as they complete.
    """
    db = get_db()
    for tc in tests:
        past_rate = past_fail_rates.get(tc.tc_id, 0.0)
        res = _simulate_result(
            tc_id=tc.tc_id,
            name=tc.name,
            severity=tc.severity,
            category=tc.category,
            run_id=run_id,
            past_fail_rate=past_rate,
        )
        # Actually wait the simulated duration this is what makes each result
        # appear progressively in the UI instead of all at once.
        await asyncio.sleep(res["duration"])

        doc = {
            **res,
            "run_id": run_id,
            "timestamp": datetime.utcnow(),
        }
        if data_context:
            doc["data_source"] = data_context.get("type", "auto")
            doc["data_columns"] = data_context.get("columns", [])

        await db.test_results.insert_one(doc)


async def start_run(
    requirement_id: str | None = None,
    data_context: dict[str, Any] | None = None,
) -> RunStarted:
    """
    Creates a run_id, kicks off background execution, and returns immediately.
    The caller should poll GET /results?run_id=<id> to watch results stream in.
    """
    run_id = str(uuid.uuid4())

    tests = await get_test_cases(requirement_id=requirement_id)
    if not tests:
        tests = await get_test_cases()

    tc_ids = [tc.tc_id for tc in tests]
    past_fail_rates = await _load_past_fail_rates(tc_ids)

    # Fire and forget results land in DB one by one as the background task runs
    asyncio.create_task(
        _execute_run_background(run_id, tests, data_context, past_fail_rates)
    )

    return RunStarted(run_id=run_id, total=len(tests))


async def get_results(run_id: str | None = None, limit: int = 100) -> list[TestResultOut]:
    db = get_db()
    query: dict[str, Any] = {}
    if run_id:
        query["run_id"] = run_id

    # Sort ascending so the frontend sees tests in execution order
    cursor = db.test_results.find(query).sort("timestamp", 1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [
        TestResultOut(
            id=str(d["_id"]),
            tc_id=d["tc_id"],
            name=d["name"],
            status=d["status"],
            duration=d["duration"],
            error_message=d.get("error_message"),
            run_id=d["run_id"],
            timestamp=d["timestamp"],
        )
        for d in docs
    ]


async def get_run_summary(run_id: str) -> RunSummary | None:
    db = get_db()
    cursor = db.test_results.find({"run_id": run_id})
    docs = await cursor.to_list(length=1000)
    if not docs:
        return None

    passed = sum(1 for d in docs if d["status"] == "PASS")
    failed = sum(1 for d in docs if d["status"] == "FAIL")
    skipped = sum(1 for d in docs if d["status"] == "SKIP")
    total_dur = round(sum(d["duration"] for d in docs), 2)

    return RunSummary(
        run_id=run_id,
        total=len(docs),
        passed=passed,
        failed=failed,
        skipped=skipped,
        success_rate=round(passed / len(docs) * 100, 1),
        total_duration=total_dur,
        started_at=docs[-1]["timestamp"],
    )
