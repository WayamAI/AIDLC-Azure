# AI Root Cause Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real AI Root Cause Analysis capability to the existing AIDLC Testing & Quality module given a failed Playwright test run, collect real failure evidence, correlate it with real Git history, and produce an AI-generated root cause explanation with a confidence score, backed by persisted data and a dedicated investigation UI.

**Architecture:** Extend, don't duplicate. Failure evidence is read from the existing `playwright_runs` collection (already stores per-step `status`/`error`/`duration_ms`). Git correlation reuses `app/services/repo_service.py`'s `get_repo_commits`/`get_commit_diff_content` against the `github_url` already stored on the `repo_analyses` document referenced by a run's `analysis_id`. The AI call follows the exact prompt→`_clean_json`→`json.loads` pattern used by every other `ai_service.py` function. Background work uses FastAPI `BackgroundTasks` (the codebase has no Celery/queue this is the established convention). A new `root_cause_analyses` Mongo collection stores results, org-scoped like every other newer collection. Frontend follows the `DefectPrediction.tsx` template (PageShell/PageHeader/PageStat, TanStack Query) plus a new investigation detail page, wired into the existing `nav-config.ts` "testing" section and `App.tsx`.

**Tech Stack:** FastAPI, Motor (MongoDB), Pydantic v2, Ollama via `ai_service.py`'s OpenAI-compatible client, React 18 + TypeScript + Vite, TanStack Query, shadcn/ui, Tailwind, react-router-dom.

**Spec:** This plan implements sections 3, 4, 5, 16 (root-cause portion), 17 (root-cause tables), 18 (root-cause routes), 25 (error handling), 27 (audit trail), 28 (root-cause tests), and the "AI Root Cause Analysis" bullet list in section 34 of the user's original feature brief (pasted into conversation 2026-08-21, no separate file the brief itself is the spec of record for this plan).

## Global Constraints

- Do not remove or modify any existing route, service, or model unless the change is additive (e.g. appending a nav item).
- Every new Mongo query must be scoped by `org_id` (via `Depends(get_current_org)`), matching every route in `repo_analysis.py`/`baseline.py`.
- No hardcoded/fake metrics anywhere every number in the UI comes from a real Mongo document or a real computation. If data isn't available (e.g. branch name, HTTP request/response), the API must return `null`/empty and the UI must render "Not available", never a fabricated value.
- AI calls must follow the existing `ai_service.py` pattern: async wrapper around `_call_openai`, `_clean_json` before `json.loads`, wrapped in `try/except AIQuotaError` / generic `except Exception` with a safe fallback never let an AI failure 500 the endpoint.
- Never send secrets (`GITHUB_TOKEN`, `OLLAMA_API_KEY`, `MONGODB_URI`) to the LLM prompt.
- Background work uses `BackgroundTasks`, not a new queue system.
- New frontend page must visually match `DefectPrediction.tsx`'s conventions: `PageShell size="full"`, `PageHeader`, `floating-card p-6` panels, `DS_RISK`/`design-system.ts` tokens for status coloring not new one-off colors.

---

## File Structure

```
backend/
  app/models/root_cause.py                    [NEW] Pydantic models
  app/services/root_cause_service.py           [NEW] evidence collection + persistence
  app/services/ai_service.py                   [MODIFY] add analyze_test_failure_root_cause()
  app/routes/root_cause.py                     [NEW] 5 endpoints
  main.py                                       [MODIFY] register root_cause.router
  tests/test_root_cause.py                      [NEW] pytest suite

frontend/src/
  lib/api.ts                                    [MODIFY] add rootCause.* API block + TS types
  hooks/use-root-cause.ts                       [NEW] TanStack Query hooks
  pages/RootCauseAnalysis.tsx                   [NEW] list/summary page
  pages/RootCauseDetail.tsx                     [NEW] investigation detail page
  lib/nav-config.ts                             [MODIFY] append nav item
  App.tsx                                       [MODIFY] register 2 routes
```

---

### Task 1: Backend models

**Files:**
- Create: `backend/app/models/root_cause.py`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces: `RootCauseEvidence`, `RootCauseAnalysis`, `RootCauseOut`, `RootCauseSummaryOut`, `FailureType`, `Severity`, `ConfidenceLabel` imported by `root_cause_service.py` and `routes/root_cause.py`.

- [ ] **Step 1: Write the model file**

```python
"""
AI Root Cause Analysis models.

Stored in the `root_cause_analyses` Mongo collection, one document per
(run_id, test_id) analysis. Extends the existing playwright_runs /
repo_analyses data rather than duplicating it.
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

FailureType = Literal[
    "assertion", "selector_not_found", "timeout", "navigation_error",
    "network_error", "script_error", "unknown",
]
Severity = Literal["low", "medium", "high", "critical"]
ConfidenceLabel = Literal["high", "medium", "low"]
AnalysisStatus = Literal["analyzing", "completed", "failed"]


def confidence_label(confidence: float) -> ConfidenceLabel:
    if confidence >= 90:
        return "high"
    if confidence >= 70:
        return "medium"
    return "low"


class CommitInfo(BaseModel):
    sha: str
    message: str
    author: str
    date: Optional[str] = None


class StepEvidence(BaseModel):
    step_number: int
    step_description: str
    status: Literal["pass", "fail"]
    error: Optional[str] = None


class RootCauseEvidence(BaseModel):
    """Confirmed information only nothing here is AI-inferred."""
    error_message: Optional[str] = None
    failed_step: Optional[StepEvidence] = None
    step_trace: list[StepEvidence] = Field(default_factory=list)
    expected: Optional[str] = None
    actual: Optional[str] = None
    console_logs: list[str] = Field(default_factory=list)
    recent_commits: list[CommitInfo] = Field(default_factory=list)
    git_diff: Optional[str] = None
    has_git_data: bool = False
    has_stack_trace: bool = False
    environment: Optional[str] = None
    test_type: Optional[str] = None


class RootCauseAnalysis(BaseModel):
    """Full stored document (root_cause_analyses collection)."""
    id: str = Field(alias="_id")
    org_id: str
    run_id: str
    test_id: str
    test_name: str
    repository: Optional[str] = None
    commit_sha: Optional[str] = None
    failure_type: FailureType = "unknown"
    severity: Severity = "medium"
    status: AnalysisStatus = "analyzing"

    evidence: RootCauseEvidence = Field(default_factory=RootCauseEvidence)

    # AI-inferred fields clearly separated from evidence above
    confidence: float = 0.0
    root_cause_summary: Optional[str] = None
    root_cause_explanation: Optional[str] = None
    likely_commit: Optional[CommitInfo] = None
    affected_files: list[str] = Field(default_factory=list)
    affected_tests: list[str] = Field(default_factory=list)
    affected_services: list[str] = Field(default_factory=list)
    recommendation: Optional[str] = None
    ai_error: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class RootCauseOut(BaseModel):
    """API response shape same fields, id/dates as plain str."""
    id: str
    org_id: str
    run_id: str
    test_id: str
    test_name: str
    repository: Optional[str] = None
    commit_sha: Optional[str] = None
    failure_type: FailureType
    severity: Severity
    status: AnalysisStatus
    confidence: float
    confidence_label: ConfidenceLabel
    evidence: RootCauseEvidence
    root_cause_summary: Optional[str] = None
    root_cause_explanation: Optional[str] = None
    likely_commit: Optional[CommitInfo] = None
    affected_files: list[str]
    affected_tests: list[str]
    affected_services: list[str]
    recommendation: Optional[str] = None
    ai_error: Optional[str] = None
    created_at: str
    updated_at: str


class RootCauseSummaryOut(BaseModel):
    total_failures: int
    root_causes_identified: int
    high_confidence: int
    requires_human_review: int
    unresolved_failures: int


class RootCauseListItemOut(BaseModel):
    id: str
    test_name: str
    repository: Optional[str] = None
    failure_type: FailureType
    severity: Severity
    status: AnalysisStatus
    confidence: float
    confidence_label: ConfidenceLabel
    created_at: str


class UnanalyzedFailureOut(BaseModel):
    """A failed test from playwright_runs that has no root_cause_analyses doc yet."""
    run_id: str
    test_id: str
    test_name: str
    analysis_id: str
    error: Optional[str] = None
    completed_at: Optional[str] = None
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd backend && python -c "from app.models.root_cause import RootCauseAnalysis, RootCauseOut, confidence_label; print(confidence_label(94), confidence_label(75), confidence_label(40))"`
Expected: `high medium low`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/root_cause.py
git commit -m "feat(root-cause): add Pydantic models for AI Root Cause Analysis"
```

---

### Task 2: Evidence collection + persistence service

**Files:**
- Create: `backend/app/services/root_cause_service.py`
- Test: `backend/tests/test_root_cause_service.py`

**Interfaces:**
- Consumes: `app.database.get_db` (Motor db handle passed in, not imported directly), `app.services.repo_service.get_repo_commits(github_url, n, pat) -> list[dict]`, `app.services.repo_service.get_commit_diff_content(github_url, sha) -> dict`, `app.models.root_cause.*`
- Produces: `async def collect_evidence(db, org_id, run_id, test_id) -> tuple[dict, dict]` returning `(run_doc, test_result)`; `async def build_evidence(test_result: dict, repo_doc: dict | None) -> RootCauseEvidence`; `async def ensure_indexes(db) -> None`; `async def save_analysis(db, analysis: RootCauseAnalysis) -> None`; `async def get_analysis(db, org_id, analysis_id) -> dict | None`; `async def list_analyses(db, org_id, limit=50) -> list[dict]`; `async def compute_summary(db, org_id) -> dict`; `async def list_unanalyzed_failures(db, org_id, limit=20) -> list[dict]`. These are consumed by `routes/root_cause.py` (Task 4).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_root_cause_service.py
import pytest
from app.services import root_cause_service
from app.models.root_cause import RootCauseEvidence


def _sample_test_result():
    return {
        "test_id": "t1",
        "test_name": "Checkout flow",
        "status": "failed",
        "error": None,
        "step_results": [
            {"step_description": "navigate to /checkout", "status": "pass", "error": None},
            {"step_description": "click #pay-btn", "status": "fail", "error": "Timeout 8000ms exceeded waiting for selector \"#pay-btn\""},
        ],
    }


def test_build_evidence_extracts_failed_step_and_marks_no_git_data():
    result = _sample_test_result()
    evidence = root_cause_service.build_evidence_sync(result, repo_doc=None)
    assert isinstance(evidence, RootCauseEvidence)
    assert evidence.failed_step is not None
    assert evidence.failed_step.step_description == "click #pay-btn"
    assert "Timeout" in evidence.error_message
    assert evidence.has_git_data is False
    assert evidence.recent_commits == []
    assert len(evidence.step_trace) == 2


def test_classify_failure_type_selector_not_found():
    ft = root_cause_service.classify_failure_type("Timeout 8000ms exceeded waiting for selector \"#pay-btn\"")
    assert ft == "selector_not_found"


def test_classify_failure_type_network():
    ft = root_cause_service.classify_failure_type("net::ERR_CONNECTION_REFUSED at http://localhost:8080")
    assert ft == "network_error"


def test_classify_failure_type_unknown_for_empty():
    assert root_cause_service.classify_failure_type(None) == "unknown"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_root_cause_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.root_cause_service'`

- [ ] **Step 3: Write the service**

```python
"""
AI Root Cause Analysis evidence collection and persistence.

Reads real failure data out of the existing `playwright_runs` collection
(no new run-tracking is introduced) and correlates it with the repo's real
Git history via app.services.repo_service. Never fabricates evidence: any
field that has no real data stays None/empty and the API/UI show
"Not available" rather than a guess.
"""
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from app.models.root_cause import (
    CommitInfo, RootCauseAnalysis, RootCauseEvidence, StepEvidence,
    FailureType, confidence_label,
)
from app.services import repo_service

log = logging.getLogger("root_cause_service")

COLLECTION = "root_cause_analyses"

_SELECTOR_RE = re.compile(r"waiting for selector|element.*not found|no element", re.I)
_TIMEOUT_RE = re.compile(r"timeout \d+ms exceeded|timed out", re.I)
_NETWORK_RE = re.compile(r"net::err|econnrefused|network error|failed to fetch", re.I)
_NAV_RE = re.compile(r"navigation failed|err_name_not_resolved|goto.*failed", re.I)
_ASSERTION_RE = re.compile(r"expect\(|assertion|expected .* but (got|received)|tobe\(", re.I)


def classify_failure_type(error: Optional[str]) -> FailureType:
    """Heuristic classification from the real error string no AI call needed for this part."""
    if not error:
        return "unknown"
    if _TIMEOUT_RE.search(error) and _SELECTOR_RE.search(error):
        return "selector_not_found"
    if _SELECTOR_RE.search(error):
        return "selector_not_found"
    if _NETWORK_RE.search(error):
        return "network_error"
    if _NAV_RE.search(error):
        return "navigation_error"
    if _TIMEOUT_RE.search(error):
        return "timeout"
    if _ASSERTION_RE.search(error):
        return "assertion"
    return "script_error"


def build_evidence_sync(test_result: dict[str, Any], repo_doc: Optional[dict]) -> RootCauseEvidence:
    """Pure/sync core so it's cheap to unit test; async wrapper adds Git calls."""
    step_results = test_result.get("step_results", [])
    step_trace = [
        StepEvidence(
            step_number=i + 1,
            step_description=s.get("step_description", ""),
            status=s.get("status", "pass"),
            error=s.get("error"),
        )
        for i, s in enumerate(step_results)
    ]
    failed_steps = [s for s in step_trace if s.status == "fail"]
    failed_step = failed_steps[0] if failed_steps else None
    error_message = failed_step.error if failed_step else test_result.get("error")

    return RootCauseEvidence(
        error_message=error_message,
        failed_step=failed_step,
        step_trace=step_trace,
        console_logs=[],  # not captured by playwright_service today honestly empty, not fabricated
        recent_commits=[],
        has_git_data=False,
        has_stack_trace=bool(step_trace),
        test_type="playwright_e2e",
    )


async def build_evidence(test_result: dict[str, Any], repo_doc: Optional[dict]) -> RootCauseEvidence:
    evidence = build_evidence_sync(test_result, repo_doc)
    if not repo_doc or not repo_doc.get("github_url"):
        return evidence

    github_url = repo_doc["github_url"]
    try:
        commits = repo_service.get_repo_commits(github_url, n=5)
        evidence.recent_commits = [
            CommitInfo(
                sha=c.get("sha", "")[:12],
                message=(c.get("message") or "").splitlines()[0][:200],
                author=c.get("author", "unknown"),
                date=c.get("date"),
            )
            for c in commits
        ]
        evidence.has_git_data = bool(evidence.recent_commits)
        if evidence.recent_commits:
            diff = repo_service.get_commit_diff_content(github_url, commits[0]["sha"])
            evidence.git_diff = (diff.get("diff") or "")[:6000]  # cap prompt size
    except Exception as exc:
        log.warning("Root cause: could not fetch git history for %s: %s", github_url, exc)
        # evidence.has_git_data stays False honest, not a fabricated empty success

    return evidence


async def collect_evidence(db, org_id: str, run_id: str, test_id: str) -> tuple[Optional[dict], Optional[dict]]:
    """Returns (run_doc, test_result) or (None, None) if not found."""
    run_doc = await db.playwright_runs.find_one({"_id": run_id, "org_id": org_id})
    if not run_doc:
        return None, None
    test_result = next((r for r in run_doc.get("results", []) if r.get("test_id") == test_id), None)
    return run_doc, test_result


def severity_for(failure_type: FailureType, error: Optional[str]) -> str:
    if failure_type in ("network_error", "navigation_error"):
        return "critical"
    if failure_type in ("selector_not_found", "assertion"):
        return "high"
    if failure_type == "timeout":
        return "medium"
    return "medium"


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index([("org_id", 1), ("created_at", -1)])
        await db[COLLECTION].create_index([("org_id", 1), ("run_id", 1), ("test_id", 1)])
    except Exception as exc:
        log.warning("root_cause index creation failed (non-fatal): %s", exc)


async def save_analysis(db, doc: dict) -> None:
    await db[COLLECTION].replace_one({"_id": doc["_id"], "org_id": doc["org_id"]}, doc, upsert=True)


async def get_analysis(db, org_id: str, analysis_id: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"_id": analysis_id, "org_id": org_id})


async def list_analyses(db, org_id: str, limit: int = 50) -> list[dict]:
    cursor = db[COLLECTION].find({"org_id": org_id}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def compute_summary(db, org_id: str) -> dict:
    docs = await list_analyses(db, org_id, limit=500)
    total = len(docs)
    identified = sum(1 for d in docs if d.get("status") == "completed" and d.get("root_cause_summary"))
    high_conf = sum(1 for d in docs if (d.get("confidence") or 0) >= 90)
    needs_review = sum(1 for d in docs if 0 < (d.get("confidence") or 0) < 70)
    unresolved = sum(1 for d in docs if d.get("status") != "completed")
    return {
        "total_failures": total,
        "root_causes_identified": identified,
        "high_confidence": high_conf,
        "requires_human_review": needs_review,
        "unresolved_failures": unresolved,
    }


async def list_unanalyzed_failures(db, org_id: str, limit: int = 20) -> list[dict]:
    """Scan recent playwright_runs for failed test results with no matching analysis doc."""
    analyzed = await db[COLLECTION].find({"org_id": org_id}, {"run_id": 1, "test_id": 1}).to_list(length=1000)
    analyzed_keys = {(a["run_id"], a["test_id"]) for a in analyzed}

    runs_cursor = db.playwright_runs.find(
        {"org_id": org_id, "failed": {"$gt": 0}}
    ).sort("started_at", -1).limit(30)
    runs = await runs_cursor.to_list(length=30)

    out = []
    for run in runs:
        for result in run.get("results", []):
            if result.get("status") != "failed":
                continue
            key = (run["run_id"], result["test_id"])
            if key in analyzed_keys:
                continue
            out.append({
                "run_id": run["run_id"],
                "test_id": result["test_id"],
                "test_name": result.get("test_name", "Unnamed test"),
                "analysis_id": run.get("analysis_id", ""),
                "error": result.get("error") or (
                    next((s.get("error") for s in result.get("step_results", []) if s.get("status") == "fail"), None)
                ),
                "completed_at": run.get("completed_at"),
            })
            if len(out) >= limit:
                return out
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_root_cause_service.py -v`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/root_cause_service.py backend/tests/test_root_cause_service.py
git commit -m "feat(root-cause): add evidence collection and persistence service"
```

---

### Task 3: AI analysis function in `ai_service.py`

**Files:**
- Modify: `backend/app/services/ai_service.py` (append new function; do not touch existing ones)
- Test: `backend/tests/test_root_cause_ai.py`

**Interfaces:**
- Consumes: `_call_openai(prompt, json_mode=True, task_name=...)`, `_clean_json(raw)` (already in the file, per Task-1's Global Constraints).
- Produces: `async def analyze_test_failure_root_cause(evidence: dict, test_name: str) -> dict` returning keys `root_cause_summary, root_cause_explanation, confidence, likely_commit_sha, affected_files, affected_tests, affected_services, recommendation` consumed by `routes/root_cause.py` (Task 4).

- [ ] **Step 1: Write the failing test (mocks the LLM call, tests parsing/validation only)**

```python
# backend/tests/test_root_cause_ai.py
import json
import pytest
from unittest.mock import patch
from app.services import ai_service


@pytest.mark.asyncio
async def test_analyze_test_failure_root_cause_parses_valid_json():
    fake_response = json.dumps({
        "root_cause_summary": "Selector #pay-btn no longer exists after a UI refactor.",
        "root_cause_explanation": "commit a91f2c renamed #pay-btn to #checkout-submit.",
        "confidence": 88,
        "likely_commit_sha": "a91f2c1",
        "affected_files": ["frontend/src/pages/Checkout.tsx"],
        "affected_tests": ["Checkout flow"],
        "affected_services": ["checkout"],
        "recommendation": "Update the selector to #checkout-submit.",
    })
    with patch.object(ai_service, "_call_openai", return_value=fake_response):
        result = await ai_service.analyze_test_failure_root_cause(
            evidence={"error_message": "Timeout waiting for selector #pay-btn", "recent_commits": []},
            test_name="Checkout flow",
        )
    assert result["confidence"] == 88
    assert "selector" in result["root_cause_summary"].lower()
    assert result["affected_files"] == ["frontend/src/pages/Checkout.tsx"]


@pytest.mark.asyncio
async def test_analyze_test_failure_root_cause_handles_malformed_ai_output():
    with patch.object(ai_service, "_call_openai", return_value="not json at all"):
        result = await ai_service.analyze_test_failure_root_cause(
            evidence={"error_message": "boom"}, test_name="X",
        )
    assert result["confidence"] == 0
    assert result["root_cause_summary"] is None
    assert "error" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_root_cause_ai.py -v`
Expected: FAIL with `AttributeError: module 'app.services.ai_service' has no attribute 'analyze_test_failure_root_cause'`

- [ ] **Step 3: Append the function to `ai_service.py`**

Add at the end of `backend/app/services/ai_service.py` (after the existing `analyze_release_readiness`/last function do not reorder or touch anything above):

```python
async def analyze_test_failure_root_cause(evidence: dict[str, Any], test_name: str) -> dict[str, Any]:
    """
    Correlate a real test-failure's evidence with real Git history and produce
    a root cause explanation. Returns a dict with confidence=0 and an "error"
    key on any AI failure callers must never treat that as a valid result.
    """
    commits_block = "\n".join(
        f"- {c.get('sha', '')[:12]} {c.get('message', '')} (by {c.get('author', 'unknown')})"
        for c in evidence.get("recent_commits", [])
    ) or "No recent commit history available."

    prompt = f"""You are a senior software engineer investigating a failed automated test.

Test name: {test_name}
Error message: {evidence.get('error_message') or 'Not available'}
Failed step: {(evidence.get('failed_step') or {}).get('step_description', 'Not available')}
Recent commits to this repository:
{commits_block}

Git diff of the most recent commit (may be truncated):
{(evidence.get('git_diff') or 'Not available')[:4000]}

Based ONLY on the information above, determine the most likely root cause. Do not invent
information that isn't present above if the evidence is insufficient, say so explicitly
in root_cause_explanation and lower the confidence score accordingly.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{{
  "root_cause_summary": "one sentence, plain language",
  "root_cause_explanation": "2-4 sentences explaining why, citing the specific commit/file/change if evident",
  "confidence": 0-100 integer,
  "likely_commit_sha": "short sha string or null if not evident",
  "affected_files": ["list", "of", "file", "paths", "or", "empty", "list"],
  "affected_tests": ["test names likely impacted, or just this test if unclear"],
  "affected_services": ["service/module names, or empty list"],
  "recommendation": "one concrete, actionable remediation suggestion"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="analyze_test_failure_root_cause")
        text = _clean_json(raw)
        data: dict[str, Any] = json.loads(text)
        return {
            "root_cause_summary": data.get("root_cause_summary"),
            "root_cause_explanation": data.get("root_cause_explanation"),
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))),
            "likely_commit_sha": data.get("likely_commit_sha") or None,
            "affected_files": data.get("affected_files") or [],
            "affected_tests": data.get("affected_tests") or [test_name],
            "affected_services": data.get("affected_services") or [],
            "recommendation": data.get("recommendation"),
        }
    except AIQuotaError:
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": "AI quota exceeded",
        }
    except Exception as exc:
        log.warning("Root cause AI analysis failed: %s", exc)
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": str(exc)[:300],
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_root_cause_ai.py -v`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_service.py backend/tests/test_root_cause_ai.py
git commit -m "feat(root-cause): add analyze_test_failure_root_cause AI function"
```

---

### Task 4: Backend routes + wiring

**Files:**
- Create: `backend/app/routes/root_cause.py`
- Modify: `backend/main.py:9-16` (import), `backend/main.py:~80` (register router), `backend/main.py:lifespan` (ensure_indexes call)
- Test: `backend/tests/test_root_cause_routes.py`

**Interfaces:**
- Consumes: everything from Task 1 (models), Task 2 (`root_cause_service.*`), Task 3 (`ai_service.analyze_test_failure_root_cause`), plus existing `app.auth.dependencies.get_current_org`, `app.database.get_db`.
- Produces: 5 HTTP endpoints under `/api/testing/root-cause` consumed by frontend Task 6.

- [ ] **Step 1: Write the failing route tests**

```python
# backend/tests/test_root_cause_routes.py
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch
from main import app


@pytest.fixture
def mock_org():
    class Org:
        id = "org_test_1"
    return Org()


@pytest.mark.asyncio
async def test_analyze_endpoint_missing_run_returns_404(mock_org):
    with patch("app.routes.root_cause.get_current_org", return_value=mock_org):
        with patch("app.services.root_cause_service.collect_evidence", new=AsyncMock(return_value=(None, None))):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/testing/root-cause/analyze",
                    json={"run_id": "missing", "test_id": "t1"},
                )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_analyze_endpoint_success_persists_and_returns_completed(mock_org):
    run_doc = {"_id": "run1", "analysis_id": "an1", "org_id": "org_test_1"}
    test_result = {
        "test_id": "t1", "test_name": "Checkout", "status": "failed", "error": None,
        "step_results": [{"step_description": "click #pay", "status": "fail", "error": "Timeout waiting for selector"}],
    }
    with patch("app.routes.root_cause.get_current_org", return_value=mock_org), \
         patch("app.services.root_cause_service.collect_evidence", new=AsyncMock(return_value=(run_doc, test_result))), \
         patch("app.database.get_db"), \
         patch("app.services.root_cause_service.save_analysis", new=AsyncMock()), \
         patch("app.services.ai_service.analyze_test_failure_root_cause", new=AsyncMock(return_value={
             "root_cause_summary": "Selector changed", "root_cause_explanation": "explained",
             "confidence": 91, "likely_commit_sha": None, "affected_files": [], "affected_tests": ["Checkout"],
             "affected_services": [], "recommendation": "fix selector",
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                "/api/testing/root-cause/analyze",
                json={"run_id": "run1", "test_id": "t1"},
            )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "completed"
    assert body["confidence"] == 91
    assert body["confidence_label"] == "high"
    assert body["failure_type"] == "selector_not_found"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_root_cause_routes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.routes.root_cause'` (or 404 on the route since it isn't registered)

- [ ] **Step 3: Write the route file**

```python
"""
AI Root Cause Analysis routes.

POST /api/testing/root-cause/analyze        analyze a specific failed test from a run
GET  /api/testing/root-cause                 list analyses + summary counts
GET  /api/testing/root-cause/failures        list failed tests not yet analyzed
GET  /api/testing/root-cause/{id}            full investigation detail
POST /api/testing/root-cause/{id}/rerun      re-run the underlying test via existing Playwright engine
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.root_cause import RootCauseAnalysis, confidence_label
from app.services import ai_service, root_cause_service, playwright_service

log = logging.getLogger("root_cause_routes")

router = APIRouter(prefix="/testing/root-cause", tags=["Root Cause Analysis"])


def _to_out(doc: dict) -> dict:
    return {
        **doc,
        "id": doc["_id"],
        "confidence_label": confidence_label(doc.get("confidence", 0)),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": doc["updated_at"].isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


@router.post("/analyze")
async def analyze_failure(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    run_id = (body.get("run_id") or "").strip()
    test_id = (body.get("test_id") or "").strip()
    if not run_id or not test_id:
        raise HTTPException(status_code=400, detail="run_id and test_id are required")

    run_doc, test_result = await root_cause_service.collect_evidence(db, org.id, run_id, test_id)
    if not run_doc or not test_result:
        raise HTTPException(status_code=404, detail="Run or test not found for this organization")
    if test_result.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Only failed tests can be analyzed for root cause")

    repo_doc = None
    analysis_id = run_doc.get("analysis_id")
    if analysis_id and analysis_id != "uploaded":
        repo_doc = await db.repo_analyses.find_one({"_id": analysis_id, "org_id": org.id})

    evidence = await root_cause_service.build_evidence(test_result, repo_doc)
    failure_type = root_cause_service.classify_failure_type(evidence.error_message)
    severity = root_cause_service.severity_for(failure_type, evidence.error_message)

    doc_id = str(uuid.uuid4())
    now = datetime.utcnow()
    doc = {
        "_id": doc_id,
        "org_id": org.id,
        "run_id": run_id,
        "test_id": test_id,
        "test_name": test_result.get("test_name", "Unnamed test"),
        "repository": repo_doc.get("github_url") if repo_doc else None,
        "commit_sha": evidence.recent_commits[0].sha if evidence.recent_commits else None,
        "failure_type": failure_type,
        "severity": severity,
        "status": "analyzing",
        "evidence": evidence.model_dump(),
        "confidence": 0.0,
        "root_cause_summary": None, "root_cause_explanation": None, "likely_commit": None,
        "affected_files": [], "affected_tests": [], "affected_services": [],
        "recommendation": None, "ai_error": None,
        "created_at": now, "updated_at": now,
    }

    ai_result = await ai_service.analyze_test_failure_root_cause(evidence.model_dump(), doc["test_name"])
    doc["confidence"] = float(ai_result.get("confidence", 0))
    doc["root_cause_summary"] = ai_result.get("root_cause_summary")
    doc["root_cause_explanation"] = ai_result.get("root_cause_explanation")
    doc["affected_files"] = ai_result.get("affected_files", [])
    doc["affected_tests"] = ai_result.get("affected_tests", [])
    doc["affected_services"] = ai_result.get("affected_services", [])
    doc["recommendation"] = ai_result.get("recommendation")
    doc["ai_error"] = ai_result.get("error")
    sha = ai_result.get("likely_commit_sha")
    if sha:
        match = next((c for c in evidence.recent_commits if c.sha.startswith(sha[:7])), None)
        if match:
            doc["likely_commit"] = match.model_dump()
    doc["status"] = "failed" if ai_result.get("error") else "completed"
    doc["updated_at"] = datetime.utcnow()

    await root_cause_service.save_analysis(db, doc)
    return _to_out(doc)


@router.get("")
async def list_root_causes(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    docs = await root_cause_service.list_analyses(db, org.id)
    summary = await root_cause_service.compute_summary(db, org.id)
    return {
        "summary": summary,
        "items": [
            {
                "id": d["_id"], "test_name": d["test_name"], "repository": d.get("repository"),
                "failure_type": d["failure_type"], "severity": d["severity"], "status": d["status"],
                "confidence": d.get("confidence", 0), "confidence_label": confidence_label(d.get("confidence", 0)),
                "created_at": d["created_at"].isoformat() if isinstance(d["created_at"], datetime) else d["created_at"],
            }
            for d in docs
        ],
    }


@router.get("/failures")
async def unanalyzed_failures(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    failures = await root_cause_service.list_unanalyzed_failures(db, org.id)
    return {"failures": failures}


@router.get("/{analysis_id}")
async def get_root_cause(analysis_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    doc = await root_cause_service.get_analysis(db, org.id, analysis_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return _to_out(doc)


@router.post("/{analysis_id}/rerun")
async def rerun_test(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await root_cause_service.get_analysis(db, org.id, analysis_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis = await db.repo_analyses.find_one({"_id": {"$exists": True}, "org_id": org.id, "github_url": doc.get("repository")}) \
        if doc.get("repository") else None
    test_doc = await db.playwright_tests.find_one({"_id": doc["test_id"], "org_id": org.id})
    if not test_doc or not analysis:
        raise HTTPException(
            status_code=409,
            detail="Cannot re-run: original test or repository analysis no longer exists",
        )

    new_run_id = str(uuid.uuid4())
    background_tasks.add_task(
        playwright_service.execute_playwright_tests,
        db, org.id, [test_doc], analysis["target_url"], new_run_id, analysis["_id"],
    )
    return {"run_id": new_run_id, "status": "started"}
```

- [ ] **Step 4: Wire into `main.py`**

In `backend/main.py`, change the import block (around line 9-16) from:
```python
from app.routes import (
    requirements, test_cases, test_execution, synthetic_data,
    prioritization, dashboard, repo_analysis,
    github, jira, ci_intelligence, defect_prediction, release_gate,
    monitoring, incidents, sprint,
    workspace, copilot, git_ops, coverage, test_gen,
    pipeline, impact, commit, deployments, prd, cost_logs,
)
```
to:
```python
from app.routes import (
    requirements, test_cases, test_execution, synthetic_data,
    prioritization, dashboard, repo_analysis,
    github, jira, ci_intelligence, defect_prediction, release_gate,
    monitoring, incidents, sprint,
    workspace, copilot, git_ops, coverage, test_gen,
    pipeline, impact, commit, deployments, prd, cost_logs,
    root_cause,
)
```

In the router-registration block, after `app.include_router(impact.router, prefix=API_PREFIX)` add:
```python
# AI Root Cause Analysis
app.include_router(root_cause.router, prefix=API_PREFIX)
```

In `lifespan()`, after the existing baseline-index block, add:
```python
    try:
        from app.database import get_db
        from app.services.root_cause_service import ensure_indexes as ensure_rc_indexes
        await ensure_rc_indexes(get_db())
    except Exception as exc:
        print(f"[DB] root_cause index creation failed (non-fatal): {exc}")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_root_cause_routes.py -v`
Expected: `2 passed`

- [ ] **Step 6: Run full backend test suite to confirm nothing broke**

Run: `cd backend && pytest -v`
Expected: all previously-passing tests still pass, plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/root_cause.py backend/main.py backend/tests/test_root_cause_routes.py
git commit -m "feat(root-cause): add REST routes and wire into app"
```

---

### Task 5: Additional backend edge-case tests

**Files:**
- Modify: `backend/tests/test_root_cause_service.py` (append)

**Interfaces:**
- Consumes: `root_cause_service.build_evidence`, `classify_failure_type` from Task 2.
- Produces: nothing new coverage only.

- [ ] **Step 1: Write and run the missing-stack-trace / missing-git-data / low-confidence tests**

Append to `backend/tests/test_root_cause_service.py`:

```python
def test_build_evidence_no_failed_steps_still_returns_evidence():
    result = {"test_id": "t2", "test_name": "Passing-looking test", "status": "failed", "error": "top-level crash", "step_results": []}
    evidence = root_cause_service.build_evidence_sync(result, repo_doc=None)
    assert evidence.failed_step is None
    assert evidence.error_message == "top-level crash"
    assert evidence.has_stack_trace is False


@pytest.mark.asyncio
async def test_build_evidence_git_lookup_failure_is_non_fatal(monkeypatch):
    def _boom(*a, **kw):
        raise RuntimeError("git clone failed: repo unreachable")
    monkeypatch.setattr(root_cause_service.repo_service, "get_repo_commits", _boom)
    result = {"test_id": "t3", "test_name": "X", "status": "failed", "error": "err", "step_results": []}
    evidence = await root_cause_service.build_evidence(result, repo_doc={"github_url": "https://github.com/x/y"})
    assert evidence.has_git_data is False
    assert evidence.recent_commits == []
```

Run: `cd backend && pytest tests/test_root_cause_service.py -v`
Expected: `6 passed` (4 from Task 2 + these 2)

- [ ] **Step 2: Commit**

```bash
git add backend/tests/test_root_cause_service.py
git commit -m "test(root-cause): cover missing-stack-trace and git-unavailable edge cases"
```

---

### Task 6: Frontend API client + types

**Files:**
- Modify: `frontend/src/lib/api.ts` (append new interfaces + `rootCause` block near the other Testing & Quality entries do not touch existing exports)

**Interfaces:**
- Consumes: nothing new (existing `apiClient` axios instance).
- Produces: `RootCauseSummary`, `RootCauseListItem`, `RootCauseDetail`, `UnanalyzedFailure` TS interfaces; `api.rootCause.{list, get, analyze, rerun, failures}` consumed by `hooks/use-root-cause.ts` (Task 7).

- [ ] **Step 1: Append types and API block**

Add near the top of `frontend/src/lib/api.ts`, alongside the other feature interfaces:

```typescript
// ── AI Root Cause Analysis types ──
export interface RootCauseSummary {
  total_failures: number;
  root_causes_identified: number;
  high_confidence: number;
  requires_human_review: number;
  unresolved_failures: number;
}

export interface RootCauseListItem {
  id: string;
  test_name: string;
  repository: string | null;
  failure_type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "analyzing" | "completed" | "failed";
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  created_at: string;
}

export interface StepEvidence {
  step_number: number;
  step_description: string;
  status: "pass" | "fail";
  error: string | null;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string | null;
}

export interface RootCauseEvidence {
  error_message: string | null;
  failed_step: StepEvidence | null;
  step_trace: StepEvidence[];
  expected: string | null;
  actual: string | null;
  console_logs: string[];
  recent_commits: CommitInfo[];
  git_diff: string | null;
  has_git_data: boolean;
  has_stack_trace: boolean;
  test_type: string | null;
}

export interface RootCauseDetail extends RootCauseListItem {
  run_id: string;
  test_id: string;
  commit_sha: string | null;
  evidence: RootCauseEvidence;
  root_cause_summary: string | null;
  root_cause_explanation: string | null;
  likely_commit: CommitInfo | null;
  affected_files: string[];
  affected_tests: string[];
  affected_services: string[];
  recommendation: string | null;
  ai_error: string | null;
  updated_at: string;
}

export interface UnanalyzedFailure {
  run_id: string;
  test_id: string;
  test_name: string;
  analysis_id: string;
  error: string | null;
  completed_at: string | null;
}
```

Add near the other Testing & Quality entries inside the exported `api` object:

```typescript
  // ── AI Root Cause Analysis ──
  listRootCauses: () =>
    apiClient.get<{ summary: RootCauseSummary; items: RootCauseListItem[] }>("/testing/root-cause").then(r => r.data),
  getRootCause: (id: string) =>
    apiClient.get<RootCauseDetail>(`/testing/root-cause/${id}`).then(r => r.data),
  analyzeFailure: (runId: string, testId: string) =>
    apiClient.post<RootCauseDetail>("/testing/root-cause/analyze", { run_id: runId, test_id: testId }).then(r => r.data),
  rerunRootCauseTest: (id: string) =>
    apiClient.post<{ run_id: string; status: string }>(`/testing/root-cause/${id}/rerun`).then(r => r.data),
  listUnanalyzedFailures: () =>
    apiClient.get<{ failures: UnanalyzedFailure[] }>("/testing/root-cause/failures").then(r => r.data),
```

- [ ] **Step 2: Verify the frontend still typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors introduced by this change (pre-existing errors, if any, are unrelated and unchanged).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(root-cause): add frontend API client types and methods"
```

---

### Task 7: TanStack Query hooks

**Files:**
- Create: `frontend/src/hooks/use-root-cause.ts`

**Interfaces:**
- Consumes: `api.listRootCauses`, `api.getRootCause`, `api.analyzeFailure`, `api.rerunRootCauseTest`, `api.listUnanalyzedFailures` (Task 6).
- Produces: `useRootCauseList()`, `useRootCauseDetail(id)`, `useUnanalyzedFailures()`, `useAnalyzeFailure()`, `useRerunRootCauseTest(id)` consumed by Tasks 8-9.

- [ ] **Step 1: Write the hook file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useRootCauseList() {
  return useQuery({
    queryKey: ["root-cause", "list"],
    queryFn: () => api.listRootCauses(),
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.status === "analyzing") ? 2000 : false,
  });
}

export function useRootCauseDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["root-cause", "detail", id],
    queryFn: () => api.getRootCause(id as string),
    enabled: !!id,
  });
}

export function useUnanalyzedFailures() {
  return useQuery({
    queryKey: ["root-cause", "failures"],
    queryFn: () => api.listUnanalyzedFailures(),
  });
}

export function useAnalyzeFailure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, testId }: { runId: string; testId: string }) =>
      api.analyzeFailure(runId, testId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["root-cause"] });
    },
  });
}

export function useRerunRootCauseTest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.rerunRootCauseTest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["root-cause"] });
    },
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-root-cause.ts
git commit -m "feat(root-cause): add TanStack Query hooks"
```

---

### Task 8: List/summary page

**Files:**
- Create: `frontend/src/pages/RootCauseAnalysis.tsx`

**Interfaces:**
- Consumes: `useRootCauseList`, `useUnanalyzedFailures`, `useAnalyzeFailure` (Task 7); `PageShell`, `PageHeader`, `PageStat` (existing `components/PageShell.tsx`/`PageHeader.tsx`); `DS_RISK` (existing `lib/design-system.ts`); `Badge`, `Button` (existing `components/ui/*`).
- Produces: default-exported `RootCauseAnalysis` component consumed by `App.tsx` (Task 10).

- [ ] **Step 1: Write the page**

```tsx
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ShieldQuestion, Sparkles, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useRootCauseList, useUnanalyzedFailures, useAnalyzeFailure } from "@/hooks/use-root-cause";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-500",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-500",
  medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  low: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "text-emerald-500",
  medium: "text-yellow-600",
  low: "text-red-500",
};

export default function RootCauseAnalysis() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseList();
  const { data: failuresData, isLoading: failuresLoading } = useUnanalyzedFailures();
  const analyzeMutation = useAnalyzeFailure();

  const summary = data?.summary;

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PageHeader
          icon={ShieldQuestion}
          title="AI Root Cause Analysis"
          description="AI-correlated failure evidence and Git history for every failed test what broke, why, and what likely caused it."
        />
      </motion.div>

      {isLoading && (
        <div className="floating-card p-8 text-center text-sm text-muted-foreground">Loading analyses…</div>
      )}
      {isError && (
        <div className="floating-card border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Could not load root cause analyses. Try again shortly.
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <PageStat icon={AlertTriangle} label="Total Failures" value={summary.total_failures} accent="destructive" />
          <PageStat icon={Sparkles} label="Root Causes Identified" value={summary.root_causes_identified} accent="primary" />
          <PageStat icon={CheckCircle2} label="High Confidence" value={summary.high_confidence} accent="success" />
          <PageStat icon={ShieldQuestion} label="Needs Human Review" value={summary.requires_human_review} accent="warning" />
          <PageStat icon={Clock} label="Unresolved" value={summary.unresolved_failures} accent="destructive" />
        </div>
      )}

      {/* Unanalyzed failures real data pulled live from playwright_runs */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Failures Awaiting Analysis</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Failed test results from recent Live Test Runner runs that haven't been analyzed yet.
        </p>
        <div className="mt-4 space-y-2">
          {failuresLoading && <p className="text-xs text-muted-foreground">Checking recent runs…</p>}
          {!failuresLoading && (failuresData?.failures.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">No unanalyzed failures nice.</p>
          )}
          {failuresData?.failures.map((f) => (
            <div key={`${f.run_id}-${f.test_id}`} className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{f.test_name}</p>
                <p className="truncate text-xs text-muted-foreground">{f.error || "No error message captured"}</p>
              </div>
              <Button
                size="sm"
                disabled={analyzeMutation.isPending}
                onClick={() => analyzeMutation.mutate({ runId: f.run_id, testId: f.test_id })}
              >
                {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Analyzed failures list */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Investigations</h2>
        <div className="mt-4 space-y-2">
          {(data?.items.length ?? 0) === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">No investigations yet analyze a failure above to start one.</p>
          )}
          {data?.items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/root-cause/${item.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3 text-left transition hover:bg-muted/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.test_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.repository ?? "No repository"} · {item.failure_type.replace(/_/g, " ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={SEVERITY_STYLE[item.severity]}>{item.severity}</Badge>
                {item.status === "completed" ? (
                  <span className={`text-xs font-semibold ${CONFIDENCE_STYLE[item.confidence_label]}`}>
                    {item.confidence}% confidence
                  </span>
                ) : item.status === "analyzing" ? (
                  <Badge variant="outline">Analyzing…</Badge>
                ) : (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">AI analysis failed</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (If `PageStat`'s `accent` prop doesn't include `"warning"`/`"destructive"` as valid values, check `components/PageHeader.tsx`'s `PageStatProps` union from the architecture map and adjust to the actual accepted values before proceeding do not silently drop the prop.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RootCauseAnalysis.tsx
git commit -m "feat(root-cause): add list/summary page"
```

---

### Task 9: Investigation detail page

**Files:**
- Create: `frontend/src/pages/RootCauseDetail.tsx`

**Interfaces:**
- Consumes: `useRootCauseDetail`, `useRerunRootCauseTest` (Task 7); `useParams`, `useNavigate` from `react-router-dom`.
- Produces: default-exported `RootCauseDetail` component consumed by `App.tsx` (Task 10).

- [ ] **Step 1: Write the page**

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, GitCommit, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { useRootCauseDetail, useRerunRootCauseTest } from "@/hooks/use-root-cause";

export default function RootCauseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseDetail(id);
  const rerunMutation = useRerunRootCauseTest(id ?? "");

  if (isLoading) {
    return (
      <PageShell size="lg" className="py-12 text-center text-sm text-muted-foreground">
        Loading investigation…
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell size="lg" className="py-12 text-center text-sm text-destructive">
        Could not load this analysis. It may not exist for your organization.
      </PageShell>
    );
  }

  return (
    <PageShell size="lg" className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/root-cause")} className="gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Root Cause Analysis
      </Button>

      {/* Failure summary */}
      <div className="floating-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{data.test_name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{data.repository ?? "No repository linked"}</p>
          </div>
          <Badge variant="outline" className="uppercase">{data.status}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Severity</p><p className="font-medium capitalize">{data.severity}</p></div>
          <div><p className="text-xs text-muted-foreground">Confidence</p><p className="font-medium">{data.status === "completed" ? `${data.confidence}% (${data.confidence_label})` : "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Failure Type</p><p className="font-medium capitalize">{data.failure_type.replace(/_/g, " ")}</p></div>
        </div>
      </div>

      {/* Root cause */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Root Cause</h2>
        {data.ai_error ? (
          <p className="mt-2 text-sm text-destructive">AI analysis failed: {data.ai_error}. Evidence below is still real and available for manual review.</p>
        ) : (
          <>
            <p className="mt-2 text-sm font-medium">{data.root_cause_summary}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{data.root_cause_explanation}</p>
            {data.likely_commit && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-xs">
                <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono">{data.likely_commit.sha}</span>
                <span className="text-muted-foreground">{data.likely_commit.message}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Evidence */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Evidence</h2>
        <div className="mt-3 space-y-1">
          {data.evidence.step_trace.length === 0 && (
            <p className="text-xs text-muted-foreground">No step trace available.</p>
          )}
          {data.evidence.step_trace.map((s) => (
            <div key={s.step_number} className={`rounded border px-3 py-2 text-xs ${s.status === "fail" ? "border-destructive/30 bg-destructive/5" : "border-border/20"}`}>
              <span className="font-mono text-muted-foreground">#{s.step_number}</span> {s.step_description}
              {s.error && <p className="mt-1 text-destructive">{s.error}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Git data: {data.evidence.has_git_data ? `${data.evidence.recent_commits.length} recent commits found` : "Not available for this run"}
        </p>
      </div>

      {/* Impact */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Impact</h2>
        <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Affected Files</p><p className="font-medium">{data.affected_files.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Affected Tests</p><p className="font-medium">{data.affected_tests.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Affected Services</p><p className="font-medium">{data.affected_services.length}</p></div>
        </div>
      </div>

      {/* Recommendation + actions */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">AI Recommendation</h2>
        <p className="mt-2 text-sm text-muted-foreground">{data.recommendation ?? "No recommendation available."}</p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={rerunMutation.isPending} onClick={() => rerunMutation.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" /> {rerunMutation.isPending ? "Starting…" : "Re-run Test"}
          </Button>
        </div>
        {rerunMutation.isSuccess && (
          <p className="mt-2 text-xs text-emerald-500">Re-run started (run {rerunMutation.data.run_id.slice(0, 8)}) check Live Test Runner for progress.</p>
        )}
        {rerunMutation.isError && (
          <p className="mt-2 text-xs text-destructive">Could not start re-run the original test or repository analysis may no longer exist.</p>
        )}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RootCauseDetail.tsx
git commit -m "feat(root-cause): add investigation detail page"
```

---

### Task 10: Navigation + routing wiring

**Files:**
- Modify: `frontend/src/lib/nav-config.ts` (append 1 nav item + 1 icon import)
- Modify: `frontend/src/App.tsx` (append 2 routes + 2 imports)

**Interfaces:**
- Consumes: `RootCauseAnalysis` (Task 8), `RootCauseDetail` → renamed import `RootCauseDetailPage` (Task 9).
- Produces: nothing further downstream this is the final wiring task.

- [ ] **Step 1: Add the icon import and nav item**

In `frontend/src/lib/nav-config.ts`, add `ShieldQuestion` to the existing lucide-react import block (alongside `ScanSearch, FileSearch, MonitorPlay, ShieldAlert`), then modify the `"testing"` section's `items` array from:

```ts
    items: [
      { title: "Repo Test Baseline", url: "/repo-baseline", icon: ScanSearch, hint: "Playwright test scan" },
      { title: "Doc-Driven Tests", url: "/doc-tests", icon: FileSearch, hint: "Docs → test scenarios" },
      { title: "Live Test Runner", url: "/live-testing", icon: MonitorPlay, hint: "AI browser execution" },
      { title: "Defect Prediction", url: "/defect-prediction", icon: ShieldAlert, hint: "File risk scoring" },
    ],
```
to:
```ts
    items: [
      { title: "Repo Test Baseline", url: "/repo-baseline", icon: ScanSearch, hint: "Playwright test scan" },
      { title: "Doc-Driven Tests", url: "/doc-tests", icon: FileSearch, hint: "Docs → test scenarios" },
      { title: "Live Test Runner", url: "/live-testing", icon: MonitorPlay, hint: "AI browser execution" },
      { title: "Defect Prediction", url: "/defect-prediction", icon: ShieldAlert, hint: "File risk scoring" },
      { title: "AI Root Cause Analysis", url: "/root-cause", icon: ShieldQuestion, hint: "Failure diagnosis" },
    ],
```

- [ ] **Step 2: Add the routes**

In `frontend/src/App.tsx`, add imports alongside the other page imports:
```tsx
import RootCauseAnalysis from "@/pages/RootCauseAnalysis";
import RootCauseDetailPage from "@/pages/RootCauseDetail";
```
and inside the `<Route element={<DashboardLayout />}>` block, alongside the `/defect-prediction` route:
```tsx
            <Route path="/root-cause" element={<RootCauseAnalysis />} />
            <Route path="/root-cause/:id" element={<RootCauseDetailPage />} />
```

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: builds successfully, no type errors.

- [ ] **Step 4: Manual smoke test**

Run: `cd backend && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000 --reload` (or `8001` per `CLAUDE.md`'s port-conflict note) in one terminal, `cd frontend && npm run dev` in another. Open `http://localhost:8080/root-cause` page should load, show the summary row (zeros are fine if no analyses exist yet), and "Failures Awaiting Analysis" should either show real failed tests from a prior Live Test Runner run or "No unanalyzed failures". Click a failure's "Analyze" button (needs at least one real failed Playwright run to exist if none exists, first go run Live Test Runner against a broken selector to produce one) and confirm it navigates correctly and the detail page renders real evidence.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nav-config.ts frontend/src/App.tsx
git commit -m "feat(root-cause): wire nav item and routes"
```

---

### Task 11: Full regression check existing features still work

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && pytest -v`
Expected: every pre-existing test still passes, plus all new `test_root_cause_*.py` tests.

- [ ] **Step 2: Verify each existing Testing & Quality page still loads with no console errors**

With both servers running (Task 10 Step 4), open in the browser and check the console for errors:
- `http://localhost:8080/repo-baseline`
- `http://localhost:8080/doc-tests`
- `http://localhost:8080/live-testing`
- `http://localhost:8080/defect-prediction`
- `http://localhost:8080/dashboard`

Expected: all five load and function exactly as before this plan (no new console errors, no broken layout).

- [ ] **Step 3: Verify the new nav item renders in the correct position**

Confirm the sidebar's "Testing & Quality" group now shows, in order: Repo Test Baseline, Doc-Driven Tests, Live Test Runner, Defect Prediction, AI Root Cause Analysis and that clicking it highlights correctly and matches the visual style of the other four items exactly.

- [ ] **Step 4: Commit (if any fixes were needed in Steps 1-3)**

```bash
git add -A
git commit -m "fix(root-cause): address regression findings from full smoke test"
```

If no fixes were needed, skip this step nothing to commit.

---

## Self-Review Notes

**Spec coverage:** §3 (evidence collection) → Task 2. §4 (list page: summary + failure list) → Task 8. §5 (investigation view: summary/root cause/evidence/impact/recommendation/actions) → Task 9. §16 (confidence system) → `confidence_label()` in Task 1, used throughout. §17 (DB design, extend not duplicate) → Task 1 model + Task 2 service deliberately reuse `playwright_runs`/`repo_analyses`, only adding `root_cause_analyses`. §18 (routes) → Task 4, matches the spec's route list exactly (plus one additive `/failures` endpoint per Global Constraints' "if equivalent doesn't exist, add it, follow conventions"). §23 (real data only) → enforced throughout Task 2/4/8/9 via explicit "Not available" / empty-list honesty rather than fabricated values. §25 (error handling) → AI failure path in Task 3/4 never 500s, surfaces `ai_error` to the UI. §27 (audit trail) → `created_at`/`updated_at`/`org_id` on every document; a dedicated audit-log table is out of scope for this first slice and should be proposed as a follow-up once Test Selection and Self-Healing (which share the same audit need) are also built, to avoid three divergent one-off implementations. §28 (tests) → Tasks 2, 3, 5 cover successful analysis, missing stack trace, missing Git data, AI failure, and low confidence is implicitly covered (Task 3's malformed-output test returns confidence 0, and any real low score renders via `confidence_label`). §31 (don't break existing) → Task 11.

**Placeholder scan:** no TBD/TODO/"implement later" strings; every code block is complete and real.

**Type consistency:** `RootCauseOut`/`RootCauseDetail` field names match between backend `_to_out()` and frontend `RootCauseDetail` interface (`confidence_label`, `failure_type`, `affected_files`, etc.). `StepEvidence`/`CommitInfo` field names match between Pydantic (Task 1) and TypeScript (Task 6). Route paths match between Task 4 (`/testing/root-cause/...`) and Task 6's `apiClient` calls exactly, including the `/failures` and `/{id}/rerun` sub-paths.
