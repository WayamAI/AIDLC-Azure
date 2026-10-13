"""Test Execution runs cases on a bounded pool of browsers and still reports them in case order."""
import asyncio
from collections import deque
from types import SimpleNamespace

import pytest

from app.services import execution_service

RUN = {"run_id": "run-1", "requirement_id": "req-1", "target_url": "http://app.test"}
STEPS = [
    {"action": "navigate", "value": "/", "description": "open"},
    {"action": "click", "selector": "#go", "description": "go"},
    {"action": "assert_text", "value": "Done", "description": "see Done"},
]


def _case(n: int):
    return SimpleNamespace(
        id=f"id-{n}", tc_id=f"TC-{n:03d}", name=f"Case {n}", description="d", expected="e",
        category="functional", severity="High",
    )


def _plans(cases, skip=()):
    return {
        c.tc_id: (
            {"automatable": False, "reason": "needs an inbox", "steps": []} if c.tc_id in skip
            else {"automatable": True, "steps": STEPS}
        )
        for c in cases
    }


def _passing(steps):
    return [{"status": "pass", "error": None, "screenshot": None} for _ in steps]


async def test_results_are_stored_in_case_order_with_bounded_concurrency(db, monkeypatch):
    cases = [_case(n) for n in range(1, 8)]
    # Earlier cases take longer, so completion order is the reverse of case order.
    delay = {index: 0.06 - index * 0.008 for index in range(len(cases))}
    state = {"active": 0, "peak": 0, "workers": 0, "finished": []}

    async def fake_worker(target_url, run_id, pending, jobs, outcomes, notify):
        state["workers"] += 1
        while True:
            try:
                index = pending.popleft()
            except IndexError:
                return
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            await asyncio.sleep(delay[index])
            state["active"] -= 1
            state["finished"].append(index)
            outcomes[index] = {"steps": _passing(jobs[index][1]), "error": None, "duration": delay[index]}
            notify()

    monkeypatch.setattr(execution_service, "_browser_worker", fake_worker)
    monkeypatch.setattr(execution_service.settings, "TEST_EXECUTION_CONCURRENCY", 3)

    await execution_service._run_cases(db, "org-1", RUN, cases, _plans(cases, skip={"TC-004"}), None, None)

    assert state["workers"] == 3 and state["peak"] == 3
    assert state["finished"] != sorted(state["finished"])  # they really did finish out of order

    results = await execution_service.get_results(db, "org-1", run_id="run-1")
    assert [r.tc_id for r in results] == [c.tc_id for c in cases]
    assert [r.status for r in results] == ["PASS", "PASS", "PASS", "SKIP", "PASS", "PASS", "PASS"]
    stamps = [r.timestamp for r in results]
    assert stamps == sorted(stamps) and len(set(stamps)) == len(stamps)


async def test_concurrency_never_exceeds_the_number_of_runnable_cases(db, monkeypatch):
    cases = [_case(1), _case(2)]
    started: list[int] = []

    async def fake_worker(target_url, run_id, pending, jobs, outcomes, notify):
        started.append(1)
        while pending:
            index = pending.popleft()
            outcomes[index] = {"steps": _passing(jobs[index][1]), "error": None, "duration": 0.0}
            notify()

    monkeypatch.setattr(execution_service, "_browser_worker", fake_worker)
    monkeypatch.setattr(execution_service.settings, "TEST_EXECUTION_CONCURRENCY", 5)
    await execution_service._run_cases(db, "org-1", RUN, cases, _plans(cases, skip={"TC-002"}), None, None)

    assert len(started) == 1
    assert [r.status for r in await execution_service.get_results(db, "org-1", run_id="run-1")] == ["PASS", "SKIP"]


async def test_cases_no_browser_could_take_fail_with_the_real_error(db, monkeypatch):
    cases = [_case(1), _case(2)]

    async def dead_worker(*_args):
        raise RuntimeError("Executable doesn't exist at chromium")

    monkeypatch.setattr(execution_service, "_browser_worker", dead_worker)
    await execution_service._run_cases(db, "org-1", RUN, cases, _plans(cases), None, None)

    results = await execution_service.get_results(db, "org-1", run_id="run-1")
    assert [r.status for r in results] == ["FAIL", "FAIL"]
    assert all("Executable doesn't exist" in r.error_message for r in results)
    assert all(step.status == "not_run" for r in results for step in r.steps)


async def test_only_the_failing_and_final_steps_are_screenshotted(monkeypatch):
    requested: list[str] = []

    async def fake_run_step(page, step, target_url, run_id, name, index, screenshot="always"):
        requested.append(screenshot)
        return {"status": "pass", "error": None, "screenshot": "shot" if screenshot == "always" else None}

    closed: list[bool] = []

    class Ctx:
        async def new_page(self):
            return object()

        async def close(self):
            closed.append(True)

    class Browser:
        def on(self, _event, _handler):
            pass

        async def new_context(self, **_kw):
            return Ctx()

    monkeypatch.setattr(execution_service, "_run_step", fake_run_step)
    results = await execution_service._run_steps(Browser(), "http://app.test", "run-1", "Case", STEPS)

    assert requested == ["on_failure", "on_failure", "always"]
    assert [r["screenshot"] for r in results] == [None, None, "shot"]
    assert closed == [True]


class _FakePlaywright:
    """async_playwright() stand-in that counts browser launches and contexts."""

    def __init__(self, die_after_first_test: bool = False):
        self.launches = 0
        self.contexts = 0
        self.die_after_first_test = die_after_first_test
        self.chromium = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def launch(self, **_kw):
        self.launches += 1
        outer = self

        class Ctx:
            async def new_page(self):
                return object()

            async def close(self):
                pass

        class Browser:
            connected = True

            def is_connected(self):
                return self.connected

            def on(self, _event, _handler):
                pass

            async def new_context(self, **_kw):
                outer.contexts += 1
                if outer.die_after_first_test and outer.contexts == 1:
                    self.connected = False
                    raise RuntimeError("Target page, context or browser has been closed")
                return Ctx()

            async def close(self):
                pass

        return Browser()


async def _run_worker(monkeypatch, fake, jobs):
    import playwright.async_api

    async def fake_run_step(page, step, target_url, run_id, name, index, screenshot="always"):
        return {"status": "pass", "error": None, "screenshot": None}

    monkeypatch.setattr(playwright.async_api, "async_playwright", lambda: fake)
    monkeypatch.setattr(execution_service, "_run_step", fake_run_step)
    outcomes: dict = {}
    notified: list[int] = []
    loop = asyncio.get_running_loop()
    await execution_service._browser_worker(
        "http://app.test", "run-1", deque(sorted(jobs)), jobs, outcomes,
        lambda: loop.call_soon_threadsafe(notified.append, 1),
    )
    await asyncio.sleep(0)
    return outcomes, notified


async def test_one_browser_is_reused_with_a_fresh_context_per_test(monkeypatch):
    fake = _FakePlaywright()
    jobs = {i: (f"Case {i}", STEPS) for i in range(4)}
    outcomes, notified = await _run_worker(monkeypatch, fake, jobs)

    assert fake.launches == 1
    assert fake.contexts == 4
    assert sorted(outcomes) == [0, 1, 2, 3] and len(notified) == 4
    assert all(o["error"] is None and len(o["steps"]) == 3 for o in outcomes.values())


async def test_a_crashed_browser_fails_only_its_test_and_is_relaunched(monkeypatch):
    fake = _FakePlaywright(die_after_first_test=True)
    jobs = {i: (f"Case {i}", STEPS) for i in range(3)}
    outcomes, _ = await _run_worker(monkeypatch, fake, jobs)

    assert fake.launches == 2
    assert "Browser could not run this test" in outcomes[0]["error"]
    assert outcomes[1]["error"] is None and outcomes[2]["error"] is None
