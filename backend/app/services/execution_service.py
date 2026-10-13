"""
Test execution service: runs a requirement's test cases against a live target URL.

Pipeline for one run:
  1. Snapshot the target site in a real browser (visible controls, headings, links).
  2. Ask the LLM to turn each test case into Playwright steps using only what the
     snapshot shows, or to declare it not automatable through this UI.
  3. Execute the planned steps in headless Chromium and record what happened.

Nothing here is simulated. A test is PASS only if every step ran and at least one
assertion held; FAIL carries the real browser error; SKIP carries the reason the
case could not be checked through the UI.
"""
import asyncio
import hashlib
import ipaddress
import json
import logging
import re
import socket
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.models.test_execution import RunStarted, RunSummary, TestResultOut
from app.services import ai_service
from app.services.playwright_service import _run_step, run_in_playwright_loop, launch_chromium
from app.services.test_case_service import get_test_cases

log = logging.getLogger("execution")

RUNS = "test_runs"
RESULTS = "test_results"
PLANS = "test_plans"

USERNAME_TOKEN = "{{USERNAME}}"
PASSWORD_TOKEN = "{{PASSWORD}}"

_MAX_PAGES = 6
_PLAN_BATCH = 8
_ALLOWED_ACTIONS = {
    "navigate", "click", "fill", "assert_text", "wait", "press",
    "check", "uncheck", "select_option", "hover", "clear",
}

# Background tasks for runs owned by this process. A run that says "running" in
# Mongo but is missing here was cut off by a restart.
_active: dict[str, asyncio.Task] = {}


class InvalidTargetError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def validate_target_url(target_url: str) -> str:
    """Normalise the target and refuse hosts the server must not browse on a user's behalf."""
    url = (target_url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise InvalidTargetError("Target URL must start with http:// or https://")
    if settings.APP_ENV == "production":
        try:
            infos = socket.getaddrinfo(parsed.hostname, None)
        except socket.gaierror as exc:
            raise InvalidTargetError(f"Could not resolve {parsed.hostname}") from exc
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise InvalidTargetError("Target URL must be a public address")
    return url.rstrip("/")


# ── 1. Site snapshot ─────────────────────────────────────────────────────────

_SNAPSHOT_JS = """
() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (v) => String(v).replace(/"/g, '\\\\"');
  const text = (el) => (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) { const l = document.querySelector(`label[for="${q(el.id)}"]`); if (l) return text(l); }
    const wrap = el.closest('label');
    return wrap ? text(wrap) : '';
  };
  const selectorOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const a of ['data-testid', 'name', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) return `${tag}[${a}="${q(v)}"]`;
    }
    const t = text(el);
    const type = el.getAttribute('type');
    const typed = type ? `${tag}[type="${q(type)}"]` : tag;
    if ((tag === 'button' || tag === 'a' || el.getAttribute('role')) && t) return `${typed}:has-text("${q(t)}")`;
    return type ? typed : null;
  };
  const controls = [];
  document.querySelectorAll('input, textarea, select, button, a[href], [role=button], [role=tab], [role=checkbox]').forEach((el) => {
    if (!visible(el)) return;
    const selector = selectorOf(el);
    if (!selector) return;
    controls.push({
      kind: el.tagName.toLowerCase(), type: el.getAttribute('type') || undefined,
      selector, text: text(el) || undefined, label: labelOf(el) || undefined,
    });
  });
  // Two controls can share a label (a "Sign in" tab and a "Sign in" submit button).
  // Number the repeats so each selector names exactly one control.
  const seen = {};
  controls.forEach((c) => { (seen[c.selector] = seen[c.selector] || []).push(c); });
  Object.values(seen).filter((group) => group.length > 1).forEach((group) => {
    group.forEach((c, i) => { c.selector = `${c.selector} >> nth=${i}`; });
  });
  const links = [...document.querySelectorAll('a[href]')]
    .filter((a) => a.href.startsWith(location.origin))
    .map((a) => ({ href: a.href.split('#')[0], text: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 60) }));
  return {
    title: document.title,
    headings: [...document.querySelectorAll('h1, h2, h3')].filter(visible).map(text).filter(Boolean).slice(0, 12),
    controls: controls.slice(0, 60),
    text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 900),
    links,
  };
}
"""


_EMAIL_FIELD = (
    'input[type="email"], input[name*="email" i], input[name*="user" i], '
    'input[autocomplete="username"], input[type="text"]'
)


async def _try_sign_in(page: Any, username: str, password: str) -> bool:
    """Fill the first visible login form and submit it. True if the browser left the form."""
    pwd = page.locator('input[type="password"]').first
    try:
        if not await pwd.is_visible(timeout=1_000):
            return False
        before = page.url
        await page.locator(_EMAIL_FIELD).first.fill(username, timeout=3_000)
        await pwd.fill(password, timeout=3_000)
        await pwd.press("Enter")
        try:
            await page.wait_for_url(lambda url: url != before, timeout=10_000)
        except Exception:
            pass
        try:
            await page.wait_for_load_state("networkidle", timeout=6_000)
        except Exception:
            pass
        return not await page.locator('input[type="password"]').first.is_visible(timeout=1_000)
    except Exception:
        return False


_STOPWORDS = frozenset(
    "with that this from then when have will must should into after before each only user users page "
    "test tests case cases valid invalid correct shown show displays display verify check using".split()
)


def _keywords(cases: list[Any]) -> set[str]:
    """Words that describe what the cases are about, used to choose which pages to open."""
    text = " ".join(f"{c.name} {c.description}" for c in cases).lower()
    return {w for w in re.findall(r"[a-z][a-z0-9]{3,}", text) if w not in _STOPWORDS}


def _relevance(link: dict[str, str], keywords: set[str]) -> int:
    words = set(re.findall(r"[a-z][a-z0-9]{3,}", f"{link.get('text', '')} {link.get('href', '')}".lower()))
    return len(words & keywords)


async def _snapshot_site(
    target_url: str,
    username: str | None = None,
    password: str | None = None,
    keywords: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Open the target and a few same-origin pages; return what a user could see and act on.

    With credentials, the signed-out page is captured first, then the browser signs in
    and the crawl continues, so plans can reference screens behind the login.
    The page budget is spent on the links most related to `keywords` (the test cases'
    own words) rather than on whichever links come first in the document.
    """
    from playwright.async_api import async_playwright

    async def _job() -> list[dict[str, Any]]:
        pages: list[dict[str, Any]] = []
        async with async_playwright() as pw:
            browser = await launch_chromium(pw, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
                page = await ctx.new_page()
                # (relevance, discovery order, url): most relevant first, then first seen.
                queue: list[tuple[int, int, str]] = [(0, 0, target_url)]
                seen: set[str] = set()
                discovered = 0
                signed_in = False
                while queue and len(pages) < _MAX_PAGES:
                    queue.sort(key=lambda item: (-item[0], item[1]))
                    _, _, url = queue.pop(0)
                    if url.rstrip("/") in seen:
                        continue
                    seen.add(url.rstrip("/"))
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                        try:
                            await page.wait_for_load_state("networkidle", timeout=6_000)
                        except Exception:
                            pass
                        snap = await page.evaluate(_SNAPSHOT_JS)
                    except Exception as exc:
                        if not pages:
                            raise RuntimeError(f"Could not open {url}: {str(exc)[:200]}") from exc
                        continue
                    # Record the URL the browser ended on a redirect to /login is itself a finding.
                    landed = page.url
                    snap["path"] = landed[len(target_url):] or "/" if landed.startswith(target_url) else landed
                    snap["signed_in"] = signed_in
                    for link in snap.pop("links"):
                        if link["href"].rstrip("/") not in seen:
                            discovered += 1
                            queue.append((_relevance(link, keywords or set()), discovered, link["href"]))
                    pages.append(snap)
                    if username and password and not signed_in and await _try_sign_in(page, username, password):
                        signed_in = True
                        landed = page.url.split("#")[0]
                        seen.discard(landed.rstrip("/"))
                        # Visit the post-login landing page next, whatever its relevance.
                        queue.append((10_000, 0, landed))
            finally:
                await browser.close()
        return pages

    return await run_in_playwright_loop(_job)


# ── 2. Planning ──────────────────────────────────────────────────────────────

def _plan_prompt(target_url: str, pages: list[dict[str, Any]], cases: list[Any], has_credentials: bool) -> str:
    case_lines = [
        {"tc_id": c.tc_id, "name": c.name, "description": c.description, "expected": c.expected}
        for c in cases
    ]
    cred = (
        f"Test credentials are available. Write the literal tokens {USERNAME_TOKEN} and {PASSWORD_TOKEN} "
        "as fill values wherever a valid login is needed; they are substituted at run time."
        if has_credentials
        else "No test credentials were provided. Any case that needs a valid login is not automatable."
    )
    return f"""You are a QA automation engineer. Convert manual test cases into browser steps for a live app.

TARGET URL: {target_url}
{cred}

WHAT THE BROWSER SEES (snapshot of real pages; "controls" lists every visible input, button and link with a working selector; pages with "signed_in": true are only reachable after logging in):
{json.dumps(pages, indent=1)}

TEST CASES:
{json.dumps(case_lines, indent=1)}

Return ONLY JSON:
{{"plans":[{{"tc_id":str,"automatable":bool,"reason":str,"steps":[{{"action":str,"selector":str|null,"value":str|null,"description":str}}]}}]}}

Rules:
- One plan per test case, same tc_id.
- Use ONLY selectors that appear in the snapshot. Never invent a selector, a route, or page text.
- Actions: navigate (value = path such as "/login"), click, fill, press (value = key), check, uncheck, select_option, hover, clear, wait, assert_text (value = text that must be visible).
- Start with navigate. A test that needs a signed-in page must log in through the login form first. Include at least one assert_text that proves the expected result; assert text you can reasonably expect the app to show, not text copied from the test case.
- After a click that submits a form, assert the visible outcome (or wait) before any further navigate; navigating immediately cancels the request.
- Every test starts signed out in a fresh browser. Do signed-out checks first; the only way to sign out mid-test is a visible sign-out control in the snapshot.
- Set "automatable": false with a one-sentence "reason" and empty steps when the case cannot be verified through this UI. Typical reasons: it needs an email inbox, a backend outage, direct API or database access, waiting for time to pass, or a screen that is not in the snapshot.
- Do not weaken a case to make it automatable. If the snapshot does not show the feature, say so.
"""


async def _plan_cases(target_url: str, pages: list[dict[str, Any]], cases: list[Any], has_credentials: bool) -> dict[str, dict[str, Any]]:
    """tc_id → plan. Cases the model did not return are left out; the caller reports them."""
    plans: dict[str, dict[str, Any]] = {}

    async def _batch(batch: list[Any]) -> None:
        parsed = await ai_service._call_openai_json(
            _plan_prompt(target_url, pages, batch, has_credentials),
            timeout=240.0,
            task_name="Plan Test Execution",
        )
        for plan in (parsed.get("plans") or []) if isinstance(parsed, dict) else []:
            if isinstance(plan, dict) and plan.get("tc_id"):
                plans[str(plan["tc_id"])] = plan

    batches = [cases[i:i + _PLAN_BATCH] for i in range(0, len(cases), _PLAN_BATCH)]
    outcomes = await asyncio.gather(*(_batch(b) for b in batches), return_exceptions=True)
    failures = [o for o in outcomes if isinstance(o, BaseException)]
    if failures and not plans:
        raise failures[0]
    return plans


def _case_fingerprint(case: Any) -> str:
    """Changes when the case text changes, so an edited case is planned again."""
    text = "\n".join((case.name, case.description, case.expected))
    return hashlib.sha256(text.encode()).hexdigest()[:16]


async def _load_saved_plans(db, org_id: str, target_url: str, cases: list[Any], has_credentials: bool) -> dict[str, dict[str, Any]]:
    """tc_id → saved plan, for cases whose text and credential availability are unchanged."""
    by_id = {c.id: c for c in cases}
    saved: dict[str, dict[str, Any]] = {}
    cursor = db[PLANS].find({"org_id": org_id, "target_url": target_url, "test_case_id": {"$in": list(by_id)}})
    async for doc in cursor:
        case = by_id[doc["test_case_id"]]
        if doc.get("fingerprint") == _case_fingerprint(case) and doc.get("had_credentials") == has_credentials:
            saved[case.tc_id] = doc["plan"]
    return saved


async def _save_plans(db, org_id: str, target_url: str, cases: list[Any], plans: dict[str, dict[str, Any]], has_credentials: bool) -> None:
    for case in cases:
        plan = plans.get(case.tc_id)
        if plan is None:
            continue
        await db[PLANS].update_one(
            {"org_id": org_id, "target_url": target_url, "test_case_id": case.id},
            {"$set": {
                "plan": {
                    "tc_id": case.tc_id,
                    "automatable": bool(plan.get("automatable")),
                    "reason": plan.get("reason"),
                    "steps": plan.get("steps") or [],
                },
                "fingerprint": _case_fingerprint(case),
                "had_credentials": has_credentials,
                "updated_at": _now(),
            }},
            upsert=True,
        )


def _check_plan(plan: dict[str, Any] | None) -> tuple[list[dict[str, Any]], str | None]:
    """Return (steps, skip_reason). A plan that cannot prove anything is skipped, not run."""
    if plan is None:
        return [], "The planner returned no plan for this case"
    if not plan.get("automatable"):
        return [], str(plan.get("reason") or "Not verifiable through the UI")[:300]
    steps = [s for s in (plan.get("steps") or []) if isinstance(s, dict)]
    unknown = sorted({str(s.get("action")) for s in steps} - _ALLOWED_ACTIONS)
    if unknown:
        return [], f"Plan used unsupported actions: {', '.join(unknown)}"
    if not any(s.get("action") == "assert_text" and s.get("value") for s in steps):
        return [], "Plan had no assertion, so it could not prove the expected result"
    return steps, None


# ── 3. Execution ─────────────────────────────────────────────────────────────

def _with_credentials(steps: list[dict[str, Any]], username: str | None, password: str | None) -> list[dict[str, Any]]:
    out = []
    for step in steps:
        value = step.get("value")
        if isinstance(value, str):
            value = value.replace(USERNAME_TOKEN, username or "").replace(PASSWORD_TOKEN, password or "")
        out.append({**step, "value": value})
    return out


_BROWSER_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"]


async def _run_steps(browser: Any, target_url: str, run_id: str, name: str,
                     steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run one test in a fresh browser context, so no cookies or storage carry over."""
    ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
    try:
        page = await ctx.new_page()
        results: list[dict[str, Any]] = []
        for index, step in enumerate(steps, 1):
            # Only the failing step's and the final step's screenshots are stored.
            capture = "always" if index == len(steps) else "on_failure"
            result = await _run_step(page, step, target_url, run_id, name, index, screenshot=capture)
            results.append(result)
            if result["status"] == "fail":
                break  # later steps depend on this one; running them only adds noise
        return results
    finally:
        try:
            await ctx.close()
        except Exception:
            pass


async def _browser_worker(target_url: str, run_id: str, pending: deque,
                          jobs: dict[int, tuple[str, list[dict[str, Any]]]],
                          outcomes: dict[int, dict[str, Any]], notify: Any) -> None:
    """Take tests off `pending` until it is empty, reusing one browser process for all of them.

    On Windows this runs on its own Proactor loop in a worker thread, so everything
    shared with the caller is a plain container and `notify` must be thread-safe.
    """
    from playwright.async_api import async_playwright

    async def _job() -> None:
        async with async_playwright() as pw:
            browser = None
            try:
                while True:
                    try:
                        index = pending.popleft()
                    except IndexError:
                        return
                    name, steps = jobs[index]
                    outcome: dict[str, Any] = {"steps": [], "error": None}
                    started = time.monotonic()
                    try:
                        # Launched on first use, and again if an earlier test crashed it.
                        if browser is None or not browser.is_connected():
                            browser = await launch_chromium(pw, headless=True, args=_BROWSER_ARGS)
                        outcome["steps"] = await _run_steps(browser, target_url, run_id, name, steps)
                    except Exception as exc:
                        outcome["error"] = f"Browser could not run this test: {str(exc)[:300]}"
                    outcome["duration"] = round(time.monotonic() - started, 2)
                    outcomes[index] = outcome
                    notify()
            finally:
                if browser is not None:
                    try:
                        await browser.close()
                    except Exception:
                        pass

    await run_in_playwright_loop(_job)


def _result_doc(org_id: str, run: dict[str, Any], case: Any, steps: list[dict[str, Any]],
                skip_reason: str | None, outcome: dict[str, Any] | None) -> dict[str, Any]:
    """The stored result for one case. `outcome` is None for a skipped case."""
    doc: dict[str, Any] = {
        "org_id": org_id,
        "run_id": run["run_id"],
        "requirement_id": run["requirement_id"],
        "test_case_id": case.id,
        "tc_id": case.tc_id,
        "name": case.name,
        "category": case.category,
        "severity": case.severity,
        "target_url": run["target_url"],
        "duration": 0.0,
        "error_message": None,
        "skip_reason": skip_reason,
        "steps": [],
        "screenshot": None,
    }

    if skip_reason or outcome is None:
        doc["status"] = "SKIP"
    else:
        step_results = outcome["steps"]
        doc["error_message"] = outcome["error"]
        doc["duration"] = outcome["duration"]

        failed = next((r for r in step_results if r["status"] == "fail"), None)
        # Stored steps keep the credential tokens, never the real values.
        doc["steps"] = [
            {
                "action": plan_step.get("action"),
                "description": plan_step.get("description") or plan_step.get("action"),
                "status": step_results[i]["status"] if i < len(step_results) else "not_run",
                "error": step_results[i].get("error") if i < len(step_results) else None,
            }
            for i, plan_step in enumerate(steps)
        ]
        if failed:
            doc["status"] = "FAIL"
            doc["error_message"] = failed.get("error") or "Step failed"
            doc["screenshot"] = failed.get("screenshot")
        elif doc["error_message"]:
            doc["status"] = "FAIL"
        else:
            doc["status"] = "PASS"
            doc["screenshot"] = step_results[-1].get("screenshot") if step_results else None
    return doc


async def _run_cases(db, org_id: str, run: dict[str, Any], cases: list[Any],
                     plans: dict[str, dict[str, Any]], username: str | None, password: str | None) -> None:
    """Run every case, with up to TEST_EXECUTION_CONCURRENCY browsers at once.

    Results are stored in test-case order whatever order the browsers finish in:
    a finished test waits for the cases before it, and timestamps strictly
    increase, so reads sorted by timestamp match a one-at-a-time run.
    """
    checked = [_check_plan(plans.get(case.tc_id)) for case in cases]
    jobs = {
        index: (case.name, _with_credentials(steps, username, password))
        for index, (case, (steps, skip_reason)) in enumerate(zip(cases, checked))
        if not skip_reason
    }
    outcomes: dict[int, dict[str, Any]] = {}
    stored = 0
    last_stamp = _now()

    async def _store_ready() -> None:
        nonlocal stored, last_stamp
        while stored < len(cases):
            steps, skip_reason = checked[stored]
            if not skip_reason and stored not in outcomes:
                return
            doc = _result_doc(org_id, run, cases[stored], steps, skip_reason, outcomes.pop(stored, None))
            last_stamp = max(_now(), last_stamp + timedelta(milliseconds=1))  # MongoDB keeps milliseconds
            doc["timestamp"] = last_stamp
            await db[RESULTS].insert_one(doc)
            stored += 1

    if jobs:
        loop = asyncio.get_running_loop()
        wake = asyncio.Event()
        pending = deque(sorted(jobs))
        count = max(1, min(settings.TEST_EXECUTION_CONCURRENCY, len(jobs)))
        workers = asyncio.gather(
            *(
                _browser_worker(run["target_url"], run["run_id"], pending, jobs, outcomes,
                                lambda: loop.call_soon_threadsafe(wake.set))
                for _ in range(count)
            ),
            return_exceptions=True,
        )
        workers.add_done_callback(lambda _: wake.set())
        try:
            while True:
                finished = workers.done()
                wake.clear()
                await _store_ready()
                if finished:
                    break
                await wake.wait()
        finally:
            if not workers.done():
                workers.cancel()

        # A worker that died before taking a case leaves it without an outcome.
        crashes = [r for r in workers.result() if isinstance(r, BaseException)]
        reason = str(crashes[0])[:300] if crashes else "the browser worker stopped unexpectedly"
        for index in jobs:
            if index >= stored and index not in outcomes:
                outcomes[index] = {
                    "steps": [], "error": f"Browser could not run this test: {reason}", "duration": 0.0,
                }

    await _store_ready()


async def _set_run(db, run_id: str, **fields: Any) -> None:
    await db[RUNS].update_one({"run_id": run_id}, {"$set": fields})


async def _execute_run(db, org_id: str, run: dict[str, Any], cases: list[Any],
                       username: str | None, password: str | None, replan: bool,
                       replan_skipped: bool = False) -> None:
    run_id = run["run_id"]
    target = run["target_url"]
    has_credentials = bool(username and password)
    try:
        # Saved plans keep runs comparable: a case runs the same steps until it is
        # edited or the user asks for a fresh plan.
        plans = {} if replan else await _load_saved_plans(db, org_id, target, cases, has_credentials)
        if replan_skipped:
            # A saved "not automatable" verdict was reached against an earlier snapshot
            # of the site. Plan those cases again; plans that do run are kept as they are.
            plans = {tc_id: plan for tc_id, plan in plans.items() if plan.get("automatable")}
        unplanned = [c for c in cases if c.tc_id not in plans]
        await _set_run(db, run_id, plans_reused=len(plans), plans_created=len(unplanned))

        if unplanned:
            await _set_run(db, run_id, phase="Opening the target in a browser")
            pages = await _snapshot_site(target, username, password, _keywords(unplanned))
            await _set_run(db, run_id, phase=f"Planning {len(unplanned)} tests against {len(pages)} page(s)",
                           pages_scanned=[p.get("path") for p in pages])
            new_plans = await _plan_cases(target, pages, unplanned, has_credentials)
            await _save_plans(db, org_id, target, unplanned, new_plans, has_credentials)
            plans.update(new_plans)

        await _set_run(db, run_id, phase="Running tests in the browser")
        await _run_cases(db, org_id, run, cases, plans, username, password)

        await _set_run(db, run_id, status="completed", phase="Done", completed_at=_now())
    except ai_service.AIQuotaError as exc:
        await _set_run(db, run_id, status="failed", error=f"AI provider quota reached: {exc}", completed_at=_now())
    except Exception as exc:
        log.exception("run %s failed", run_id)
        await _set_run(db, run_id, status="failed", error=str(exc)[:500], completed_at=_now())
    finally:
        _active.pop(run_id, None)


async def start_run(
    db,
    org_id: str,
    requirement_id: str,
    target_url: str,
    username: str | None = None,
    password: str | None = None,
    replan: bool = False,
    replan_skipped: bool = False,
) -> RunStarted:
    """Create the run record and start executing in the background. Poll the run to follow it."""
    target = validate_target_url(target_url)
    cases = await get_test_cases(db, org_id, requirement_id=requirement_id)
    if not cases:
        raise LookupError("This requirement has no test cases to run")

    run = {
        "run_id": str(uuid.uuid4()),
        "org_id": org_id,
        "requirement_id": requirement_id,
        "target_url": target,
        "status": "running",
        "phase": "Queued",
        "total": len(cases),
        "error": None,
        "started_at": _now(),
        "completed_at": None,
    }
    await db[RUNS].insert_one(dict(run))
    _active[run["run_id"]] = asyncio.create_task(_execute_run(db, org_id, run, cases, username, password, replan, replan_skipped)
    )
    return RunStarted(run_id=run["run_id"], total=len(cases))


# ── Reads ────────────────────────────────────────────────────────────────────

def _result_out(d: dict[str, Any], with_screenshot: bool = True) -> TestResultOut:
    return TestResultOut(
        id=str(d["_id"]),
        tc_id=d["tc_id"],
        name=d["name"],
        status=d["status"],
        duration=d.get("duration", 0.0),
        error_message=d.get("error_message"),
        run_id=d["run_id"],
        timestamp=d["timestamp"],
        category=d.get("category"),
        severity=d.get("severity"),
        skip_reason=d.get("skip_reason"),
        steps=d.get("steps") or [],
        screenshot=d.get("screenshot") if with_screenshot else None,
    )


async def get_results(db, org_id: str, run_id: str | None = None, limit: int = 100) -> list[TestResultOut]:
    query: dict[str, Any] = {"org_id": org_id}
    if run_id:
        query["run_id"] = run_id
    # Ascending so the caller sees tests in execution order.
    docs = await db[RESULTS].find(query).sort("timestamp", 1).limit(limit).to_list(length=limit)
    # Screenshots are only worth the payload when one run is being inspected.
    return [_result_out(d, with_screenshot=bool(run_id)) for d in docs]


async def _load_run(db, org_id: str, run_id: str) -> dict[str, Any] | None:
    run = await db[RUNS].find_one({"run_id": run_id, "org_id": org_id})
    if run and run["status"] == "running" and run_id not in _active:
        fields = {"status": "failed", "error": "Run was interrupted by a server restart", "completed_at": _now()}
        await _set_run(db, run_id, **fields)
        run.update(fields)
    return run


async def _summarise(db, org_id: str, run: dict[str, Any]) -> RunSummary:
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    duration = 0.0
    async for d in db[RESULTS].find({"run_id": run["run_id"], "org_id": org_id}, {"status": 1, "duration": 1}):
        counts[d["status"]] = counts.get(d["status"], 0) + 1
        duration += d.get("duration", 0.0)
    executed = counts["PASS"] + counts["FAIL"]
    return RunSummary(
        run_id=run["run_id"],
        status=run["status"],
        phase=run.get("phase"),
        error=run.get("error"),
        target_url=run["target_url"],
        requirement_id=run.get("requirement_id"),
        plans_reused=run.get("plans_reused", 0),
        plans_created=run.get("plans_created", 0),
        total=run["total"],
        completed=sum(counts.values()),
        passed=counts["PASS"],
        failed=counts["FAIL"],
        skipped=counts["SKIP"],
        # Skipped cases were never checked, so they do not count toward the pass rate.
        # A run where nothing was executed (every case skipped, or none finished yet)
        # has no pass rate; 0% would read as "everything failed".
        success_rate=round(counts["PASS"] / executed * 100, 1) if executed else None,
        total_duration=round(duration, 2),
        started_at=run["started_at"],
        completed_at=run.get("completed_at"),
    )


async def get_run_summary(db, org_id: str, run_id: str) -> RunSummary | None:
    run = await _load_run(db, org_id, run_id)
    return await _summarise(db, org_id, run) if run else None


async def list_runs(db, org_id: str, requirement_id: str | None = None, limit: int = 20) -> list[RunSummary]:
    query: dict[str, Any] = {"org_id": org_id}
    if requirement_id:
        query["requirement_id"] = requirement_id
    runs = await db[RUNS].find(query, {"run_id": 1}).sort("started_at", -1).limit(limit).to_list(length=limit)
    out = []
    for r in runs:
        run = await _load_run(db, org_id, r["run_id"])
        if run:
            out.append(await _summarise(db, org_id, run))
    return out


async def ensure_indexes(db) -> None:
    await db[RUNS].create_index([("org_id", 1), ("started_at", -1)])
    await db[RUNS].create_index("run_id", unique=True)
    await db[RESULTS].create_index([("org_id", 1), ("run_id", 1), ("timestamp", 1)])
    await db[PLANS].create_index([("org_id", 1), ("target_url", 1), ("test_case_id", 1)], unique=True)
