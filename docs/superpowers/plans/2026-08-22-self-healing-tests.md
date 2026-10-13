# Self-Healing Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a failed Playwright test whose failure is a UI selector no longer matching (the mechanically healable case the spec's own example targets `#login-btn` → `#sign-in-btn`), scan the *live* target page for real candidate elements, use the LLM to pick the best match from those real candidates only (never inventing a selector that isn't actually on the page), validate the candidate against the live DOM, classify confidence, and require explicit human approval before writing anything back to the stored test. Other failure types (API schema drift, endpoint changes, assertion changes) are honestly reported as low-confidence / not-yet-automatable rather than faked.

**Architecture:** Reuse, don't duplicate. Failure detection and classification reuse `root_cause_service.classify_failure_type` and `root_cause_service.collect_evidence` (built in the prior plan) a healing attempt starts from the exact same `playwright_runs` failure data Root Cause Analysis uses. The candidate-repair step does a real, live DOM scan (a small dedicated Playwright launch, mirroring `playwright_service`'s existing headless-Chromium launch args for consistency) to collect real interactive elements, then asks the LLM (via the existing `ai_service.py` pattern) to pick the best match *by index* from that real list the AI can never hallucinate a selector because it's constrained to choosing among elements that were actually observed on the page. Approval writes the healed selector back into the existing `playwright_tests` collection using the same `update_one` pattern `repo_analysis.py`'s `PUT /tests/{test_id}` already uses. A new `healing_attempts` collection persists every attempt (audit trail), org-scoped like every other newer collection.

**Tech Stack:** FastAPI, Motor (MongoDB), Pydantic v2, Playwright (already a dependency via `playwright_service`), existing `ai_service.py` OpenAI-compatible client, React 18 + TypeScript + Vite, TanStack Query, shadcn/ui.

**Spec:** Sections 12-16, 18 (healing routes), 21 (cross-feature integration with Root Cause Analysis), 23 (real data only), 25 (error handling) of the user's original feature brief (pasted into conversation 2026-08-21 spec of record for this plan, alongside the codebase as ground truth for every reused function).

## Global Constraints

- Never write to `playwright_tests` (or any test definition) except inside the `/approve` endpoint, and only after an explicit human action no automatic writes anywhere else in this feature.
- Every new Mongo query must be org-scoped via `Depends(get_current_org)`.
- The AI's candidate selector must always be chosen from a list of selectors the DOM scan actually observed on the live page never freely generated text. If the DOM scan finds zero plausible candidates, or the target page is unreachable, the attempt must be `status="failed"` with an honest explanation, never a fabricated "healed" result.
- Confidence bands: `>= 90` high (safe to fast-approve), `70-89` medium (needs review), `< 70` low (do not suggest applying explain why).
- Any blocking/synchronous call from an `async def` must be wrapped in `asyncio.to_thread`, per the established convention from the prior two plans.
- New frontend pages must match the established `PageShell`/`PageHeader`/`floating-card p-6`/`DS_RISK` conventions from `DefectPrediction.tsx`, `RootCauseAnalysis.tsx`, `TestSelection.tsx`.

---

## File Structure

```
backend/
  app/models/healing.py                        [NEW] Pydantic models
  app/services/healing_service.py               [NEW] DOM scan, candidate scoring, playwright-tests write-back
  app/services/ai_service.py                     [MODIFY] add suggest_selector_repair()
  app/routes/healing.py                          [NEW] 6 endpoints
  main.py                                         [MODIFY] register healing.router
  tests/test_healing_service.py                   [NEW] pytest suite
  tests/test_healing_ai.py                        [NEW] pytest suite
  tests/test_healing_routes.py                    [NEW] pytest suite

frontend/src/
  lib/api.ts                                      [MODIFY] add healing types + api methods
  hooks/use-healing.ts                            [NEW] TanStack Query hooks
  pages/SelfHealingTests.tsx                       [NEW] dashboard: overview counts, recent healing events
  pages/HealingDetail.tsx                          [NEW] before/after diff, validation, approve/reject
  lib/nav-config.ts                                [MODIFY] append nav item
  App.tsx                                          [MODIFY] register 2 routes
```

---

### Task 1: Backend models

**Files:**
- Create: `backend/app/models/healing.py`

**Interfaces:**
- Produces: `HealingCandidate`, `ValidationResult`, `HealingAttempt`, `HealingAttemptOut`, `HealingSummaryOut`, `healing_confidence_label(score: float) -> str` imported by Tasks 2-4.

- [ ] **Step 1: Write the model file**

```python
"""
Self-Healing Tests models.

A "healing attempt" starts from one failed step of one test in a
playwright_runs run, proposes a repaired selector found on the live page
(never invented), validates it, and requires explicit approval before any
write to the stored test. Stored in `healing_attempts`.
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

HealingStatus = Literal["pending", "approved", "rejected", "failed"]
ConfidenceLabel = Literal["high", "medium", "low"]


def healing_confidence_label(score: float) -> ConfidenceLabel:
    if score >= 90:
        return "high"
    if score >= 70:
        return "medium"
    return "low"


class DomElementCandidate(BaseModel):
    """One real interactive element observed on the live page during the scan."""
    selector: str
    tag: str
    text: Optional[str] = None
    role: Optional[str] = None
    element_id: Optional[str] = None


class HealingCandidate(BaseModel):
    selector: Optional[str] = None       # None = no safe candidate found
    source: Literal["dom_scan_ai_ranked", "none"] = "none"
    reasoning: Optional[str] = None
    considered: list[DomElementCandidate] = Field(default_factory=list)


class ValidationResult(BaseModel):
    attempted: bool = False
    selector_found_on_page: Optional[bool] = None
    error: Optional[str] = None


class HealingAttempt(BaseModel):
    id: str = Field(alias="_id")
    org_id: str
    run_id: str
    test_id: str
    step_number: int
    test_name: str
    failure_type: str
    original_selector: Optional[str] = None
    step_description: Optional[str] = None
    target_url: str

    candidate: HealingCandidate = Field(default_factory=HealingCandidate)
    validation: ValidationResult = Field(default_factory=ValidationResult)
    confidence: float = 0.0
    status: HealingStatus = "pending"
    error: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    decided_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


class HealingAttemptOut(BaseModel):
    id: str
    run_id: str
    test_id: str
    step_number: int
    test_name: str
    failure_type: str
    original_selector: Optional[str] = None
    step_description: Optional[str] = None
    target_url: str
    candidate: HealingCandidate
    validation: ValidationResult
    confidence: float
    confidence_label: ConfidenceLabel
    status: HealingStatus
    error: Optional[str] = None
    created_at: str
    decided_at: Optional[str] = None


class HealingAttemptListItemOut(BaseModel):
    id: str
    test_name: str
    failure_type: str
    original_selector: Optional[str] = None
    candidate_selector: Optional[str] = None
    confidence: float
    confidence_label: ConfidenceLabel
    status: HealingStatus
    created_at: str


class HealingSummaryOut(BaseModel):
    broken_tests: int
    healed_successfully: int
    pending_review: int
    failed_healing: int
    healing_success_rate: Optional[float] = None   # None = not available (no attempts yet)
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd backend && python -c "from app.models.healing import HealingAttempt, HealingAttemptOut, healing_confidence_label; print(healing_confidence_label(97), healing_confidence_label(82), healing_confidence_label(41))"`
Expected: `high medium low`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/healing.py
git commit -m "feat(healing): add Pydantic models for Self-Healing Tests"
```

---

### Task 2: DOM scan + write-back service

**Files:**
- Create: `backend/app/services/healing_service.py`
- Test: `backend/tests/test_healing_service.py`

**Interfaces:**
- Consumes: `app.services.root_cause_service.classify_failure_type`, `app.models.healing.*`, `app.models.repo_baseline` is NOT used here (healing targets `playwright_tests`, the repo_analysis/Live-Test-Runner corpus, not repo_baselines different collection, deliberately, since that's where structured `steps[].selector` live and where an update endpoint already exists).
- Produces: `async def scan_page_elements(target_url: str, path: str) -> list[DomElementCandidate]`; `def build_healing_diff(original_selector: str, candidate_selector: str) -> str` (unified-diff-style string); `async def validate_candidate(target_url: str, path: str, selector: str) -> ValidationResult`; `async def save_attempt(db, attempt: HealingAttempt) -> None`; `async def get_attempt(db, org_id, attempt_id) -> dict | None`; `async def list_attempts(db, org_id, limit=50) -> list[dict]`; `async def compute_summary(db, org_id) -> dict`; `async def apply_healed_selector(db, org_id, test_id, step_number, new_selector) -> bool` consumed by Task 4 (routes).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_healing_service.py
import pytest
from app.services import healing_service as svc
from app.models.healing import DomElementCandidate


def test_build_healing_diff_shows_before_after():
    diff = svc.build_healing_diff("#login-btn", "#sign-in-btn")
    assert "- " in diff and "#login-btn" in diff
    assert "+ " in diff and "#sign-in-btn" in diff


@pytest.mark.asyncio
async def test_scan_page_elements_unreachable_url_returns_empty_list(monkeypatch):
    # Point at a URL nothing listens on; scan must fail closed, not raise.
    result = await svc.scan_page_elements("http://127.0.0.1:1", "/")
    assert result == []


@pytest.mark.asyncio
async def test_validate_candidate_unreachable_url_reports_honest_failure():
    result = await svc.validate_candidate("http://127.0.0.1:1", "/", "#sign-in-btn")
    assert result.attempted is True
    assert result.selector_found_on_page is False
    assert result.error is not None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_healing_service.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the service**

```python
"""
Self-Healing Tests live DOM scanning, candidate validation, and the
approved write-back into playwright_tests.

Never invents a selector: scan_page_elements only returns elements it
actually observed on the live page; the AI (in ai_service.py) picks among
those by index. validate_candidate re-checks the chosen selector against
the live page before anything is ever proposed as "healed".
"""
import asyncio
import difflib
import logging
from datetime import datetime
from typing import Optional

from app.models.healing import DomElementCandidate, HealingAttempt, ValidationResult

log = logging.getLogger("healing_service")

COLLECTION = "healing_attempts"

_LAUNCH_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--use-gl=swiftshader", "--enable-webgl", "--allow-insecure-localhost",
    "--window-size=1280,720",
]


def _full_url(target_url: str, path: str) -> str:
    p = path if path.startswith("/") else f"/{path}" if path else "/"
    return target_url.rstrip("/") + p


async def scan_page_elements(target_url: str, path: str, limit: int = 40) -> list[DomElementCandidate]:
    """Real, live scan returns only elements actually present on the page.
    Fails closed (empty list) on any error; never raises to the caller."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log.warning("Healing: Playwright not installed")
        return []

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            try:
                ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
                page = await ctx.new_page()
                await page.goto(_full_url(target_url, path), wait_until="domcontentloaded", timeout=15_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=8_000)
                except Exception:
                    pass

                elements = await page.eval_on_selector_all(
                    "button, a, input, select, textarea, [role], [id]",
                    """(els) => els.slice(0, 60).map((el, i) => ({
                        tag: el.tagName.toLowerCase(),
                        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60),
                        role: el.getAttribute('role'),
                        id: el.id || null,
                        idx: i,
                    }))""",
                )
                out = []
                for el in elements[:limit]:
                    if el.get("id"):
                        selector = f"#{el['id']}"
                    else:
                        selector = f"{el['tag']}:nth-of-type({el['idx'] + 1})"
                    out.append(DomElementCandidate(
                        selector=selector, tag=el["tag"], text=el.get("text") or None,
                        role=el.get("role"), element_id=el.get("id"),
                    ))
                return out
            finally:
                await browser.close()
    except Exception as exc:
        log.warning("Healing: DOM scan failed for %s%s: %s", target_url, path, exc)
        return []


async def validate_candidate(target_url: str, path: str, selector: str) -> ValidationResult:
    """Re-checks a candidate selector against the live page. Never raises."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ValidationResult(attempted=True, selector_found_on_page=False, error="Playwright not installed")

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            try:
                ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
                page = await ctx.new_page()
                await page.goto(_full_url(target_url, path), wait_until="domcontentloaded", timeout=15_000)
                count = await page.locator(selector).count()
                return ValidationResult(attempted=True, selector_found_on_page=count > 0)
            finally:
                await browser.close()
    except Exception as exc:
        return ValidationResult(attempted=True, selector_found_on_page=False, error=str(exc)[:300])


def build_healing_diff(original_selector: str, candidate_selector: str) -> str:
    return "\n".join(difflib.unified_diff(
        [f'page.locator("{original_selector}")'],
        [f'page.locator("{candidate_selector}")'],
        lineterm="", n=0,
    ))


async def save_attempt(db, attempt: HealingAttempt) -> None:
    doc = attempt.model_dump(by_alias=True)
    await db[COLLECTION].replace_one({"_id": doc["_id"], "org_id": doc["org_id"]}, doc, upsert=True)


async def get_attempt(db, org_id: str, attempt_id: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"_id": attempt_id, "org_id": org_id})


async def list_attempts(db, org_id: str, limit: int = 50) -> list[dict]:
    cursor = db[COLLECTION].find({"org_id": org_id}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index([("org_id", 1), ("created_at", -1)])
        await db[COLLECTION].create_index([("org_id", 1), ("run_id", 1), ("test_id", 1), ("step_number", 1)])
    except Exception as exc:
        log.warning("healing index creation failed (non-fatal): %s", exc)


async def compute_summary(db, org_id: str) -> dict:
    docs = await list_attempts(db, org_id, limit=500)
    broken = len(docs)
    healed = sum(1 for d in docs if d.get("status") == "approved")
    pending = sum(1 for d in docs if d.get("status") == "pending")
    failed = sum(1 for d in docs if d.get("status") in ("failed", "rejected"))
    decided = healed + failed
    return {
        "broken_tests": broken,
        "healed_successfully": healed,
        "pending_review": pending,
        "failed_healing": failed,
        "healing_success_rate": round((healed / decided) * 100, 1) if decided else None,
    }


async def apply_healed_selector(db, org_id: str, test_id: str, step_number: int, new_selector: str) -> bool:
    """Writes the healed selector back into playwright_tests, using the same
    update_one pattern app/routes/repo_analysis.py's PUT /tests/{test_id}
    already uses. Only ever called from the /approve route, after an
    explicit human decision never automatically."""
    doc = await db.playwright_tests.find_one({"_id": test_id, "org_id": org_id})
    if not doc:
        return False
    steps = doc.get("steps", [])
    idx = step_number - 1
    if idx < 0 or idx >= len(steps):
        return False
    steps[idx]["selector"] = new_selector
    await db.playwright_tests.update_one({"_id": test_id, "org_id": org_id}, {"$set": {"steps": steps}})
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_healing_service.py -v`
Expected: `3 passed` (the two Playwright-dependent tests hit a real connection-refused error against `127.0.0.1:1` and must resolve to the honest failure path within a few seconds if Playwright itself isn't installed in the test environment, `scan_page_elements`/`validate_candidate` must still return their fail-closed values via the `ImportError` branch, not error out; verify both branches work in this environment).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/healing_service.py backend/tests/test_healing_service.py
git commit -m "feat(healing): add DOM scan, validation, and playwright_tests write-back service"
```

---

### Task 3: AI candidate-ranking function in `ai_service.py`

**Files:**
- Modify: `backend/app/services/ai_service.py` (append only)
- Test: `backend/tests/test_healing_ai.py`

**Interfaces:**
- Produces: `async def suggest_selector_repair(original_selector: str, step_description: str, candidates: list[dict]) -> dict` returning `{"selected_index": int | None, "confidence": int, "reasoning": str}` where `selected_index` indexes into the input `candidates` list (or `None` if nothing plausible) consumed by Task 4 (routes).

- [ ] **Step 1: Write the failing tests (mock the LLM call)**

```python
# backend/tests/test_healing_ai.py
import json
import pytest
from unittest.mock import AsyncMock, patch
from app.services import ai_service


@pytest.mark.asyncio
async def test_suggest_selector_repair_returns_valid_index():
    candidates = [
        {"selector": "#sign-in-btn", "tag": "button", "text": "Sign In", "role": None},
        {"selector": "#cancel-btn", "tag": "button", "text": "Cancel", "role": None},
    ]
    fake = json.dumps({"selected_index": 0, "confidence": 95, "reasoning": "Same login-flow button, renamed"})
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value=fake)):
        result = await ai_service.suggest_selector_repair("#login-btn", "click the login button", candidates)
    assert result["selected_index"] == 0
    assert result["confidence"] == 95


@pytest.mark.asyncio
async def test_suggest_selector_repair_out_of_range_index_is_rejected():
    candidates = [{"selector": "#a", "tag": "button", "text": "A", "role": None}]
    fake = json.dumps({"selected_index": 5, "confidence": 90, "reasoning": "x"})
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value=fake)):
        result = await ai_service.suggest_selector_repair("#login-btn", "click", candidates)
    # An index outside the real candidate list must never be trusted —
    # this is the hallucination guard, not just a parsing nicety.
    assert result["selected_index"] is None
    assert result["confidence"] == 0


@pytest.mark.asyncio
async def test_suggest_selector_repair_handles_malformed_ai_output():
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value="not json")):
        result = await ai_service.suggest_selector_repair("#login-btn", "click", [{"selector": "#a", "tag": "button", "text": "A", "role": None}])
    assert result["selected_index"] is None
    assert result["confidence"] == 0
    assert "error" in result
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_healing_ai.py -v`
Expected: FAIL with `AttributeError`.

- [ ] **Step 3: Append the function to `ai_service.py`**

```python
async def suggest_selector_repair(original_selector: str, step_description: str, candidates: list[dict]) -> dict[str, Any]:
    """
    Picks the best-matching REAL candidate (by index) for a broken selector.
    The AI never invents a selector it can only choose an index into the
    candidates list that was actually observed on the live page, or return
    null to signal no safe match. Any index outside the real list's range
    is a hallucination and is rejected here, not trusted.
    """
    if not candidates:
        return {"selected_index": None, "confidence": 0, "reasoning": "No candidate elements were found on the live page."}

    candidates_block = "\n".join(
        f"{i}: <{c.get('tag')}> text={c.get('text')!r} role={c.get('role')!r} selector={c.get('selector')!r}"
        for i, c in enumerate(candidates)
    )
    prompt = f"""A Playwright test step is failing because its selector no longer matches anything on the page.

Original (broken) selector: {original_selector}
Step description: {step_description}

Here are the real interactive elements actually found on the live page right now, indexed from 0:
{candidates_block}

Pick the index of the element most likely to be the intended replacement for the broken selector same
apparent purpose (e.g. same button in a login flow), even if the id/class/text changed. If nothing here
plausibly matches, say so.

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "selected_index": <integer index from the list above, or null if nothing plausibly matches>,
  "confidence": <0-100 integer>,
  "reasoning": "one or two sentences"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="suggest_selector_repair")
        text = _clean_json(raw)
        data: dict[str, Any] = json.loads(text)
        idx = data.get("selected_index")
        if idx is not None and (not isinstance(idx, int) or idx < 0 or idx >= len(candidates)):
            # Hallucination guard: an out-of-range index is never trusted.
            return {"selected_index": None, "confidence": 0, "reasoning": "AI returned an index outside the real candidate list; rejected."}
        return {
            "selected_index": idx,
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))) if idx is not None else 0,
            "reasoning": data.get("reasoning"),
        }
    except AIQuotaError:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": "AI quota exceeded"}
    except Exception as exc:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": str(exc)[:300]}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_healing_ai.py -v`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_service.py backend/tests/test_healing_ai.py
git commit -m "feat(healing): add suggest_selector_repair AI function with hallucination guard"
```

---

### Task 4: Backend routes + wiring

**Files:**
- Create: `backend/app/routes/healing.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_healing_routes.py`

**Interfaces:**
- Consumes: Tasks 1-3, plus existing `app.services.root_cause_service.collect_evidence`/`classify_failure_type` (reused directly a healing attempt starts from the same failure data as a root-cause analysis), `app.auth.dependencies.get_current_org`, `app.database.get_db`.
- Produces: 6 HTTP endpoints under `/api/testing/healing` consumed by frontend Task 5.

- [ ] **Step 1: Write the failing route tests**

Use the established real end-to-end pattern (`app_client`/`db` fixtures, `organization_service.create_organization`, `create_session_cookie` never `patch(get_current_org)`).

```python
# backend/tests/test_healing_routes.py
import pytest
from unittest.mock import AsyncMock, patch
from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_analyze_missing_run_returns_404(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h1", name="H1")
    _cookies(app_client, org.id)
    resp = await app_client.post(
        "/api/testing/healing/analyze",
        json={"run_id": "missing", "test_id": "t1", "target_url": "http://localhost:9"},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_analyze_success_path_persists_attempt(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h2", name="H2")
    _cookies(app_client, org.id)
    await db.playwright_runs.insert_one({
        "_id": "run1", "run_id": "run1", "org_id": org.id, "analysis_id": "uploaded", "status": "completed",
        "results": [{
            "test_id": "t1", "test_name": "Login flow", "status": "failed", "error": None,
            "step_results": [{"step_description": "click #login-btn", "status": "fail", "error": "Timeout waiting for selector \"#login-btn\""}],
        }],
    })
    with patch("app.routes.healing.healing_service.scan_page_elements", new=AsyncMock(return_value=[])), \
         patch("app.routes.healing.healing_service.validate_candidate", new=AsyncMock()):
        resp = await app_client.post(
            "/api/testing/healing/analyze",
            json={"run_id": "run1", "test_id": "t1", "target_url": "http://localhost:9"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "failed"  # no candidates found on (mocked) empty page scan -> honest failure
    assert body["confidence"] == 0


@pytest.mark.anyio
async def test_approve_requires_pending_attempt(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h3", name="H3")
    _cookies(app_client, org.id)
    resp = await app_client.post("/api/testing/healing/nonexistent/approve")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_healing_routes.py -v`
Expected: FAIL module/route not found.

- [ ] **Step 3: Write the route file**

Implement `backend/app/routes/healing.py` with these 6 endpoints:

- `POST /analyze` body `{run_id, test_id, target_url}`. Reuses `root_cause_service.collect_evidence(db, org.id, run_id, test_id)` to fetch the failed test result (404 if not found, 400 if the test didn't actually fail). Finds the first failed step via the same step-trace logic pattern as `root_cause_service.build_evidence_sync`. Classifies via `root_cause_service.classify_failure_type`. If `failure_type != "selector_not_found"`, persist and return a `status="failed"` attempt with `error` explaining healing isn't yet automated for this failure type (honest, not fabricated). Otherwise: extract the failed step's original selector and description, derive a `path` to scan (use `"/"` as a safe default the evidence doesn't reliably carry the exact sub-path, and scanning the app's root/landing page is a reasonable, honest starting point; note this as a known scope limit, not a bug, in your self-review), call `healing_service.scan_page_elements(target_url, path)`. If empty, persist `status="failed"` with an explanatory error. Otherwise call `ai_service.suggest_selector_repair(original_selector, step_description, [c.model_dump() for c in candidates])`; if `selected_index is None`, persist `status="failed"`. Otherwise build the candidate, call `healing_service.validate_candidate(target_url, path, candidate_selector)`, compute final confidence (AI confidence, but zeroed if validation's `selector_found_on_page` is `False`), and persist `status="pending"` for confidence `>= 70` or `status="failed"` for confidence `< 70` (per Global Constraints low confidence never proposes an apply).
- `GET ""` list attempts + summary (mirrors `root_cause.py`'s `list_root_causes` shape).
- `GET /{attempt_id}` fetch one attempt.
- `POST /{attempt_id}/validate` re-run `validate_candidate` against the stored candidate selector and update the stored `validation`/`confidence`, without regenerating a new AI candidate.
- `POST /{attempt_id}/approve` 404 if attempt doesn't exist, 409 if `status != "pending"`, 400 if `candidate.selector` is `None`. On success: call `healing_service.apply_healed_selector(db, org.id, attempt["test_id"], attempt["step_number"], attempt["candidate"]["selector"])`, set `status="approved"`, `decided_at=now`, persist, return the updated attempt.
- `POST /{attempt_id}/reject` 404 if missing, sets `status="rejected"`, `decided_at=now`, no write to `playwright_tests`.

Follow the `Depends(get_current_org)` + `db=Depends(get_db)` pattern from every other route file in this codebase.

- [ ] **Step 4: Wire into `main.py`**

Add `healing` to the router import tuple (alongside `root_cause, test_selection,`), register `app.include_router(healing.router, prefix=API_PREFIX)` after the test_selection registration, and add a `healing_service.ensure_indexes` call in `lifespan()` following the same try/except pattern as the previous two features.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_healing_routes.py -v`
Expected: `3 passed`

- [ ] **Step 6: Run full backend suite**

Run: `cd backend && pytest -v`
Expected: all previously-passing tests plus these new ones, all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/healing.py backend/main.py backend/tests/test_healing_routes.py
git commit -m "feat(healing): add REST routes and wire into app"
```

---

### Task 5: Frontend API client + hooks

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/hooks/use-healing.ts`

**Interfaces:**
- Produces: TS types (`DomElementCandidate`, `HealingCandidate`, `ValidationResult`, `HealingAttemptListItem`, `HealingAttemptDetail`, `HealingSummary`), `api.analyzeHealing`, `api.listHealingAttempts`, `api.getHealingAttempt`, `api.revalidateHealing`, `api.approveHealing`, `api.rejectHealing`; hooks `useHealingList()`, `useHealingDetail(id)`, `useAnalyzeHealing()`, `useApproveHealing(id)`, `useRejectHealing(id)`, `useRevalidateHealing(id)` consumed by Task 6.

- [ ] **Step 1: Add types + api methods to `api.ts`**

```typescript
// ── Self-Healing Tests types ──
export interface DomElementCandidate {
  selector: string;
  tag: string;
  text: string | null;
  role: string | null;
  element_id: string | null;
}

export interface HealingCandidate {
  selector: string | null;
  source: "dom_scan_ai_ranked" | "none";
  reasoning: string | null;
  considered: DomElementCandidate[];
}

export interface HealingValidationResult {
  attempted: boolean;
  selector_found_on_page: boolean | null;
  error: string | null;
}

export interface HealingAttemptListItem {
  id: string;
  test_name: string;
  failure_type: string;
  original_selector: string | null;
  candidate_selector: string | null;
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  status: "pending" | "approved" | "rejected" | "failed";
  created_at: string;
}

export interface HealingAttemptDetail extends HealingAttemptListItem {
  run_id: string;
  test_id: string;
  step_number: number;
  step_description: string | null;
  target_url: string;
  candidate: HealingCandidate;
  validation: HealingValidationResult;
  error: string | null;
  decided_at: string | null;
}

export interface HealingSummary {
  broken_tests: number;
  healed_successfully: number;
  pending_review: number;
  failed_healing: number;
  healing_success_rate: number | null;
}
```

```typescript
  // ── Self-Healing Tests ──
  analyzeHealing: (runId: string, testId: string, targetUrl: string) =>
    apiClient.post<HealingAttemptDetail>("/testing/healing/analyze", { run_id: runId, test_id: testId, target_url: targetUrl }).then(r => r.data),
  listHealingAttempts: () =>
    apiClient.get<{ summary: HealingSummary; items: HealingAttemptListItem[] }>("/testing/healing").then(r => r.data),
  getHealingAttempt: (id: string) =>
    apiClient.get<HealingAttemptDetail>(`/testing/healing/${id}`).then(r => r.data),
  revalidateHealing: (id: string) =>
    apiClient.post<HealingAttemptDetail>(`/testing/healing/${id}/validate`).then(r => r.data),
  approveHealing: (id: string) =>
    apiClient.post<HealingAttemptDetail>(`/testing/healing/${id}/approve`).then(r => r.data),
  rejectHealing: (id: string) =>
    apiClient.post<HealingAttemptDetail>(`/testing/healing/${id}/reject`).then(r => r.data),
```

- [ ] **Step 2: Create the hooks file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useHealingList() {
  return useQuery({ queryKey: ["healing", "list"], queryFn: () => api.listHealingAttempts() });
}

export function useHealingDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["healing", "detail", id],
    queryFn: () => api.getHealingAttempt(id as string),
    enabled: !!id,
  });
}

export function useAnalyzeHealing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, testId, targetUrl }: { runId: string; testId: string; targetUrl: string }) =>
      api.analyzeHealing(runId, testId, targetUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["healing"] }),
  });
}

export function useApproveHealing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.approveHealing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["healing"] }),
  });
}

export function useRejectHealing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rejectHealing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["healing"] }),
  });
}

export function useRevalidateHealing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.revalidateHealing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["healing"] }),
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-healing.ts
git commit -m "feat(healing): add frontend API client and TanStack Query hooks"
```

---

### Task 6: Dashboard + detail pages

**Files:**
- Create: `frontend/src/pages/SelfHealingTests.tsx`
- Create: `frontend/src/pages/HealingDetail.tsx`

**Interfaces:**
- Consumes: hooks from Task 5.
- Produces: default exports `SelfHealingTests` and `HealingDetailPage` consumed by `App.tsx` (Task 7).

- [ ] **Step 1: Write the dashboard page**

```tsx
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Wrench, CheckCircle2, Clock, XCircle, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/PageShell";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useHealingList } from "@/hooks/use-healing";

const STATUS_STYLE: Record<string, string> = {
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  rejected: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
  failed: "border-red-500/30 bg-red-500/10 text-red-500",
};

export default function SelfHealingTests() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useHealingList();
  const summary = data?.summary;

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PageHeader
          icon={Wrench}
          title="Self-Healing Tests"
          description="When a UI test breaks because a selector changed, AI finds the real replacement element on the live page and proposes a fix nothing is ever applied without your approval."
        />
      </motion.div>

      {isLoading && <div className="floating-card p-8 text-center text-sm text-muted-foreground">Loading healing attempts…</div>}
      {isError && <div className="floating-card border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">Could not load healing attempts.</div>}

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <PageStat icon={Wrench} label="Broken Tests" value={summary.broken_tests} accent="destructive" />
          <PageStat icon={CheckCircle2} label="Healed Successfully" value={summary.healed_successfully} accent="success" />
          <PageStat icon={Clock} label="Pending Review" value={summary.pending_review} accent="warning" />
          <PageStat icon={XCircle} label="Failed Healing" value={summary.failed_healing} accent="destructive" />
          <PageStat
            icon={TrendingUp}
            label="Success Rate"
            value={summary.healing_success_rate != null ? `${summary.healing_success_rate}%` : "Not available"}
            accent="primary"
          />
        </div>
      )}

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Recent Healing Events</h2>
        <div className="mt-4 space-y-2">
          {(data?.items.length ?? 0) === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">No healing attempts yet trigger one from a failed test in Root Cause Analysis.</p>
          )}
          {data?.items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/self-healing/${item.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3 text-left transition hover:bg-muted/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.test_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.original_selector ?? "—"} {item.candidate_selector ? `→ ${item.candidate_selector}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{item.confidence}%</span>
                <Badge variant="outline" className={STATUS_STYLE[item.status]}>{item.status}</Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Write the detail page**

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { useHealingDetail, useApproveHealing, useRejectHealing, useRevalidateHealing } from "@/hooks/use-healing";

export default function HealingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useHealingDetail(id);
  const approveMutation = useApproveHealing(id ?? "");
  const rejectMutation = useRejectHealing(id ?? "");
  const revalidateMutation = useRevalidateHealing(id ?? "");

  if (isLoading) return <PageShell size="lg" className="py-12 text-center text-sm text-muted-foreground">Loading healing attempt…</PageShell>;
  if (isError || !data) return <PageShell size="lg" className="py-12 text-center text-sm text-destructive">Could not load this healing attempt.</PageShell>;

  return (
    <PageShell size="lg" className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/self-healing")} className="gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Self-Healing Tests
      </Button>

      <div className="floating-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{data.test_name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{data.step_description ?? "No step description"}</p>
          </div>
          <Badge variant="outline" className="uppercase">{data.status}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Failure Type</p><p className="font-medium capitalize">{data.failure_type.replace(/_/g, " ")}</p></div>
          <div><p className="text-xs text-muted-foreground">Confidence</p><p className="font-medium">{data.confidence}% ({data.confidence_label})</p></div>
          <div><p className="text-xs text-muted-foreground">Target</p><p className="truncate font-medium">{data.target_url}</p></div>
        </div>
      </div>

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Proposed Repair</h2>
        {data.error && <p className="mt-2 text-sm text-destructive">{data.error}</p>}
        {data.candidate.selector && (
          <>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border/30 bg-muted/10 p-3 text-xs">
{`- page.locator("${data.original_selector}")
+ page.locator("${data.candidate.selector}")`}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">{data.candidate.reasoning}</p>
          </>
        )}
      </div>

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Validation</h2>
        <p className="mt-2 text-sm">
          {data.validation.attempted
            ? data.validation.selector_found_on_page
              ? "✓ Candidate selector confirmed present on the live page."
              : `✗ Candidate selector was not found on the live page.${data.validation.error ? ` (${data.validation.error})` : ""}`
            : "Not yet validated."}
        </p>
        <Button size="sm" variant="outline" className="mt-3 gap-1.5" disabled={revalidateMutation.isPending} onClick={() => revalidateMutation.mutate()}>
          <RefreshCw className="h-3.5 w-3.5" /> Re-validate
        </Button>
      </div>

      {data.status === "pending" && (
        <div className="floating-card p-6">
          <h2 className="text-[13px] font-semibold tracking-tight">Actions</h2>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="gap-1.5" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
              <Check className="h-3.5 w-3.5" /> Approve Repair
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
          {approveMutation.isError && <p className="mt-2 text-xs text-destructive">Could not approve try re-validating first.</p>}
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SelfHealingTests.tsx frontend/src/pages/HealingDetail.tsx
git commit -m "feat(healing): add dashboard and detail pages"
```

---

### Task 7: Nav + routing wiring, and full project regression check

**Files:**
- Modify: `frontend/src/lib/nav-config.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: Add nav item**

Add a `Wrench` icon import to `nav-config.ts`, and append to the `"testing"` section (after "Intelligent Test Selection"):

```ts
{ title: "Self-Healing Tests", url: "/self-healing", icon: Wrench, hint: "AI-repaired broken selectors" },
```

- [ ] **Step 2: Add routes**

In `App.tsx`, import `SelfHealingTests` and `HealingDetailPage`, and add:
```tsx
<Route path="/self-healing" element={<SelfHealingTests />} />
<Route path="/self-healing/:id" element={<HealingDetailPage />} />
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Full three-feature regression check**

Run: `cd backend && pytest -v` every test across all three plans (Root Cause Analysis, Intelligent Test Selection, Self-Healing Tests) plus the original 63-test baseline must be green.

Manually verify: all 7 Testing & Quality nav items load without console errors Repo Test Baseline, Doc-Driven Tests, Live Test Runner, Defect Prediction, AI Root Cause Analysis, Intelligent Test Selection, Self-Healing Tests in that exact sidebar order.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nav-config.ts frontend/src/App.tsx
git commit -m "feat(healing): wire nav item and routes"
```

---

## Self-Review Notes

**Spec coverage:** §12-13 (detect → analyze live app → generate candidate from real elements → validate → confidence-gate → require approval → apply) → Tasks 2-4, the whole pipeline. §14 (dashboard with real counts) → Task 6's `SelfHealingTests.tsx`. §15 (detail view: original/failure/AI analysis/proposed repair with diff/validation/actions) → Task 6's `HealingDetail.tsx`. §16 (confidence system, consistent labels) → `healing_confidence_label`, reused verbatim across backend/frontend. §18 (routes) → Task 4, matches the spec's route list (`analyze`, list, detail, `validate`, `approve`, `reject`). §21 (cross-feature integration) → Task 4 directly reuses `root_cause_service.collect_evidence`/`classify_failure_type` rather than re-deriving failure data. §23 (real data only) → the DOM-scan/AI-index-constraint design is the core mechanism ensuring this; "flaky"-style fabrication is structurally impossible since the AI can only choose real, observed elements. §25 (error handling) → every Playwright interaction in `healing_service.py` fails closed with an honest `ValidationResult`/empty list, never raises to the route layer.

**Deliberate scope limits, stated honestly rather than silently:** only `selector_not_found` failures get real automated healing in this plan; API-schema-drift, endpoint-change, and assertion-change healing (spec examples 2-4) are explicitly out of scope for this pass and reported as `status="failed"` with a clear explanation rather than faked a natural follow-up plan once the selector-healing pipeline is validated in production. The DOM scan always targets `path="/"` rather than the exact failing sub-page (evidence doesn't reliably carry that); this is a known, stated limitation, not a bug.

**Placeholder scan:** no TBD/TODO strings; every code block is complete and real.

**Type consistency:** `HealingAttemptOut`/`HealingCandidate`/`ValidationResult` field names match between backend and the frontend `HealingAttemptDetail`/`HealingCandidate`/`HealingValidationResult` interfaces exactly. `HealingDetailPage`'s export name matches Task 7's import exactly, mirroring the same load-bearing naming convention established in the Root Cause Analysis plan.
