"""A run with nothing executed has no pass rate, and skipped cases can be planned again."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import dashboard_service, execution_service

ORG = "org-1"
STEPS = [
    {"action": "navigate", "value": "/", "description": "open"},
    {"action": "assert_text", "value": "Done", "description": "see Done"},
]


def _case(n: int):
    return SimpleNamespace(
        id=f"id-{n}", tc_id=f"TC-{n:03d}", name=f"Case {n}", description="d", expected="e",
        category="functional", severity="High",
    )


def _run(run_id: str = "run-1") -> dict:
    return {
        "run_id": run_id, "org_id": ORG, "requirement_id": "req-1", "target_url": "http://app.test",
        "status": "running", "phase": "Queued", "total": 2, "error": None,
        "started_at": datetime.now(timezone.utc), "completed_at": None,
    }


async def _result(db, run_id: str, n: int, status: str):
    await db[execution_service.RESULTS].insert_one({
        "org_id": ORG, "run_id": run_id, "test_case_id": f"id-{n}", "tc_id": f"TC-{n:03d}",
        "name": f"Case {n}", "status": status, "duration": 1.5,
        "timestamp": datetime.now(timezone.utc),
    })


async def test_all_skipped_run_has_no_success_rate(db):
    run = _run()
    await _result(db, "run-1", 1, "SKIP")
    await _result(db, "run-1", 2, "SKIP")
    summary = await execution_service._summarise(db, ORG, run)
    assert summary.skipped == 2 and summary.passed == 0 and summary.failed == 0
    assert summary.success_rate is None


async def test_success_rate_ignores_skips_when_something_ran(db):
    run = _run()
    await _result(db, "run-1", 1, "PASS")
    await _result(db, "run-1", 2, "SKIP")
    summary = await execution_service._summarise(db, ORG, run)
    assert summary.success_rate == 100.0


async def test_all_failed_run_is_zero_not_none(db):
    run = _run()
    await _result(db, "run-1", 1, "FAIL")
    summary = await execution_service._summarise(db, ORG, run)
    assert summary.success_rate == 0.0


async def test_dashboard_reports_no_rate_when_latest_run_was_all_skipped(db):
    await _result(db, "run-1", 1, "SKIP")
    stats = await dashboard_service.get_stats(db, ORG)
    latest = stats["latest_run"]
    assert latest["success_rate"] is None and latest["avg_duration"] is None
    assert latest["total"] == 0


async def test_dashboard_reports_no_rate_before_any_run(db):
    stats = await dashboard_service.get_stats(db, ORG)
    assert stats["latest_run"]["run_id"] is None
    assert stats["latest_run"]["success_rate"] is None


async def test_weekly_trend_is_seven_calendar_days_with_real_zeroes(db):
    await _result(db, "run-1", 1, "PASS")
    await _result(db, "run-1", 2, "FAIL")
    await _result(db, "run-1", 3, "SKIP")
    # Older than the window: must not be drawn as if it were this week.
    await db[execution_service.RESULTS].insert_one({
        "org_id": ORG, "run_id": "old", "test_case_id": "id-9", "tc_id": "TC-009", "name": "Old",
        "status": "PASS", "duration": 1.0, "timestamp": datetime.now(timezone.utc) - timedelta(days=30),
    })
    trend = (await dashboard_service.get_stats(db, ORG))["weekly_trend"]
    assert len(trend) == 7
    assert trend[-1]["date"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert (trend[-1]["passed"], trend[-1]["failed"], trend[-1]["total"]) == (1, 1, 2)
    assert all(day["total"] == 0 for day in trend[:-1])


async def _execute(db, monkeypatch, cases, **kwargs):
    """Run _execute_run with the browser and the LLM replaced; returns the tc_ids that were planned."""
    planned: list[str] = []

    async def fake_snapshot(target, username, password, keywords):
        return [{"path": "/"}]

    async def fake_plan(target, pages, unplanned, has_credentials):
        planned.extend(c.tc_id for c in unplanned)
        return {c.tc_id: {"automatable": True, "steps": STEPS} for c in unplanned}

    async def fake_run_cases(db_, org_id, run, cases_, plans, username, password):
        return None

    monkeypatch.setattr(execution_service, "_snapshot_site", fake_snapshot)
    monkeypatch.setattr(execution_service, "_plan_cases", fake_plan)
    monkeypatch.setattr(execution_service, "_run_cases", fake_run_cases)
    run = _run()
    await db[execution_service.RUNS].insert_one(dict(run))
    await execution_service._execute_run(db, ORG, run, cases, None, None, **kwargs)
    stored = await db[execution_service.RUNS].find_one({"run_id": run["run_id"]})
    return planned, stored


async def _seed_plans(db, cases):
    await execution_service._save_plans(db, ORG, "http://app.test", cases, {
        "TC-001": {"automatable": True, "steps": STEPS},
        "TC-002": {"automatable": False, "reason": "The snapshot does not show this page", "steps": []},
    }, False)


async def test_saved_plans_are_reused_by_default(db, monkeypatch):
    cases = [_case(1), _case(2)]
    await _seed_plans(db, cases)
    planned, stored = await _execute(db, monkeypatch, cases, replan=False)
    assert planned == []
    assert stored["plans_reused"] == 2 and stored["plans_created"] == 0


async def test_replan_skipped_plans_only_the_not_automatable_cases(db, monkeypatch):
    cases = [_case(1), _case(2)]
    await _seed_plans(db, cases)
    planned, stored = await _execute(db, monkeypatch, cases, replan=False, replan_skipped=True)
    assert planned == ["TC-002"]
    assert stored["plans_reused"] == 1 and stored["plans_created"] == 1
    # The new verdict replaces the saved one, so the next ordinary run reuses it.
    saved = await execution_service._load_saved_plans(db, ORG, "http://app.test", cases, False)
    assert saved["TC-002"]["automatable"] is True
    assert saved["TC-001"]["steps"] == STEPS


async def test_replan_discards_every_saved_plan(db, monkeypatch):
    cases = [_case(1), _case(2)]
    await _seed_plans(db, cases)
    planned, _ = await _execute(db, monkeypatch, cases, replan=True)
    assert planned == ["TC-001", "TC-002"]
