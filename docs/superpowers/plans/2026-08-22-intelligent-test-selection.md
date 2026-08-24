# Intelligent Test Selection & Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a repo's `repo_baselines` test suite (the "Repo Test Baseline" corpus) and a commit range, determine which tests are actually relevant to the changed files, score/prioritize them, explain the selection per-test, execute only the selected subset via the existing Playwright engine, and surface duplicate/coverage-gap optimization findings all from real data, honestly labeling anything not yet connectable (flaky/long-running detection needs execution history that doesn't exist yet for baseline tests).

**Architecture:** Reuse, don't duplicate. Changed-file detection reuses `app.services.diff_service.get_changed_files` (already used for incremental baseline scans). Relevance scoring blends a direct/proximity file match against the existing `repo_baselines.tests[].source_file` field with the existing Defect Prediction risk-score computation (reusing `app.routes.defect_prediction`'s scoring logic via `github_service`, not a new AI model). Execution reuses `app.services.playwright_service.execute_playwright_tests` via a small adapter that converts `BaselineTestStep` (action/target/value/assertion) into the shape that engine already expects (action/selector/value/description) the action vocabularies differ only in one name (`expect` → `assert_text`). A new `test_selection_runs` collection persists each selection (repo, commit range, selected tests + scores + reasons, totals), org-scoped like every other newer collection.

**Tech Stack:** FastAPI, Motor (MongoDB), Pydantic v2, existing `repo_service`/`diff_service`/`github_service`/`playwright_service`, React 18 + TypeScript + Vite, TanStack Query, shadcn/ui.

**Spec:** Sections 6-11, 18 (test-selection routes), 21 (cross-feature integration), 23 (real data only), 25 (error handling) of the user's original feature brief (pasted into conversation 2026-08-21 that message is the spec of record for this plan, alongside the codebase itself as ground truth for every reused function).

## Global Constraints

- Do not remove or modify any existing route, service, or model unless the change is additive.
- Every new Mongo query must be scoped by `org_id` via `Depends(get_current_org)`, matching every route in `repo_analysis.py`/`baseline.py`/`root_cause.py`.
- No hardcoded/fake metrics. Every number (total tests, selected count, skipped count, coverage gaps) must come from a real `repo_baselines` document or a real computation over it. Where a number genuinely cannot be computed from real data yet (execution duration, flaky-test detection no baseline test has ever been executed), the API must return `null`/an explicit "not_available" flag and the UI must render "Not available", never a fabricated placeholder.
- Long-running work (the selection computation itself is fast a Mongo read + in-memory scoring, no clone needed since `repo_baselines` already has the corpus but *executing* selected tests is the same Playwright run as today, so reuse the existing `BackgroundTasks` + in-memory-`_runs`-dict + polling pattern, don't invent a second execution engine).
- Any blocking/synchronous call (subprocess `git diff`, sync HTTP) made from an `async def` must be wrapped in `asyncio.to_thread`, per the fix already applied to `root_cause_service.py` in the prior plan this is now the established convention going forward.
- New frontend pages must match `DefectPrediction.tsx`/`RootCauseAnalysis.tsx`'s established conventions: `PageShell size="full"`, `PageHeader`, `floating-card p-6` panels, `DS_RISK`/`design-system.ts` tokens for status coloring.

---

## File Structure

```
backend/
  app/models/test_selection.py                 [NEW] Pydantic models
  app/services/test_selection_service.py        [NEW] scoring, selection, optimization findings, playwright adapter
  app/routes/test_selection.py                  [NEW] 6 endpoints
  main.py                                        [MODIFY] register test_selection.router
  tests/test_test_selection_service.py           [NEW] pytest suite
  tests/test_test_selection_routes.py            [NEW] pytest suite

frontend/src/
  lib/api.ts                                     [MODIFY] add testSelection types + api methods
  hooks/use-test-selection.ts                    [NEW] TanStack Query hooks
  pages/TestSelection.tsx                        [NEW] dashboard: current change, optimization numbers, selected-test list with explanations
  lib/nav-config.ts                              [MODIFY] append nav item
  App.tsx                                        [MODIFY] register route
```

---

### Task 1: Backend models

**Files:**
- Create: `backend/app/models/test_selection.py`

**Interfaces:**
- Produces: `SelectionReason`, `SelectedTestOut`, `TestSelectionSummaryOut`, `TestSelectionRunOut`, `OptimizationFindingOut`, `TestOptimizationReportOut`, `priority_label(score: float) -> str` imported by Task 2 (service) and Task 3 (routes).

- [ ] **Step 1: Write the model file**

```python
"""
Intelligent Test Selection & Optimization models.

A "selection run" scores every active test in a repo's `repo_baselines`
document against a commit range's changed files, explains each score, and
records which tests were selected. Stored in `test_selection_runs`.
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

Priority = Literal["critical", "high", "medium", "low"]


def priority_label(score: float) -> Priority:
    if score >= 90:
        return "critical"
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


class SelectionReason(BaseModel):
    """One human-readable, evidence-backed reason a test was (or wasn't) selected."""
    label: str          # e.g. "PaymentService.ts changed"
    matched: bool        # True = this reason contributed points; False = considered but didn't apply


class SelectedTest(BaseModel):
    test_id: str
    name: str
    source_file: Optional[str] = None
    category: str
    severity: str
    score: float
    priority: Priority
    reasons: list[SelectionReason] = Field(default_factory=list)
    selected: bool


class TestSelectionRun(BaseModel):
    id: str = Field(alias="_id")
    org_id: str
    repo_id: str
    github_url: str
    old_sha: Optional[str] = None
    new_sha: Optional[str] = None
    changed_files: list[str] = Field(default_factory=list)
    diff_available: bool = True   # False = git diff failed/no baseline yet, fell back to full suite
    total_tests: int = 0
    selected_tests: list[SelectedTest] = Field(default_factory=list)
    skipped_count: int = 0
    status: Literal["completed", "failed"] = "completed"
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class SelectedTestOut(BaseModel):
    test_id: str
    name: str
    source_file: Optional[str] = None
    category: str
    severity: str
    score: float
    priority: Priority
    reasons: list[SelectionReason]
    selected: bool


class TestSelectionSummaryOut(BaseModel):
    total_tests: int
    relevant_tests: int
    selected_tests: int
    skipped_tests: int
    estimated_savings_pct: Optional[float] = None   # None = not available (no execution-time data)


class TestSelectionRunOut(BaseModel):
    id: str
    repo_id: str
    github_url: str
    old_sha: Optional[str] = None
    new_sha: Optional[str] = None
    changed_files: list[str]
    diff_available: bool
    summary: TestSelectionSummaryOut
    tests: list[SelectedTestOut]
    status: Literal["completed", "failed"]
    error: Optional[str] = None
    created_at: str


class TestSelectionRunListItemOut(BaseModel):
    id: str
    repo_id: str
    github_url: str
    summary: TestSelectionSummaryOut
    status: Literal["completed", "failed"]
    created_at: str


class OptimizationFindingOut(BaseModel):
    kind: Literal["duplicate", "coverage_gap", "flaky", "long_running"]
    description: str
    test_ids: list[str] = Field(default_factory=list)
    available: bool = True   # False = this finding kind can't be computed yet (no execution history)


class TestOptimizationReportOut(BaseModel):
    repo_id: str
    total_tests: int
    potential_duplicates: int
    coverage_gaps: int
    flaky_tests: Optional[int] = None       # None = not available
    long_running_tests: Optional[int] = None  # None = not available
    findings: list[OptimizationFindingOut]
    optimization_opportunity: Literal["high", "medium", "low"]
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd backend && python -c "from app.models.test_selection import TestSelectionRun, TestSelectionRunOut, priority_label; print(priority_label(95), priority_label(75), priority_label(50), priority_label(10))"`
Expected: `critical high medium low`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/test_selection.py
git commit -m "feat(test-selection): add Pydantic models for Intelligent Test Selection"
```

---

### Task 2: Selection + optimization service

**Files:**
- Create: `backend/app/services/test_selection_service.py`
- Test: `backend/tests/test_test_selection_service.py`

**Interfaces:**
- Consumes: `app.services.diff_service.get_changed_files(old_sha, new_sha, repo_path) -> list[str]`, `app.services.repo_service.clone_repo(github_url) -> str` / `cleanup_repo(repo_path)` / `get_repo_commits(github_url, n) -> list[dict]`, `app.services.baseline_store.get_repo(db, org_id, repo_id) -> RepoBaseline | None`, `app.services.github_service.get_commits`/`get_commit_detail` (same functions `defect_prediction.py` already uses), `app.models.test_selection.*`, `app.models.repo_baseline.BaselineTest`.
- Produces: `async def compute_file_risk_scores(owner: str, repo: str, since_days: int = 90) -> dict[str, float]` (filename → 0-100 risk score, reusing defect_prediction's math); `def score_test(test: BaselineTest, changed_files: set[str], risk_scores: dict[str, float]) -> tuple[float, list[SelectionReason]]`; `async def run_selection(db, org_id, repo_id, github_url, old_sha, new_sha) -> TestSelectionRun`; `async def save_run(db, run: TestSelectionRun) -> None`; `async def get_run(db, org_id, run_id) -> dict | None`; `async def list_runs(db, org_id, limit=20) -> list[dict]`; `async def compute_optimization_report(db, org_id, repo_id) -> TestOptimizationReportOut`; `def baseline_test_to_playwright_dict(test: BaselineTest) -> dict` consumed by Task 3 (routes).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_test_selection_service.py
import pytest
from app.services import test_selection_service as svc
from app.models.repo_baseline import BaselineTest, BaselineTestStep


def _test(test_id, source_file, category="api", severity="medium"):
    return BaselineTest(
        test_id=test_id, name=f"Test {test_id}", description="d",
        category=category, source_file=source_file, severity=severity,
        steps=[BaselineTestStep(action="navigate", target="/x")],
    )


def test_score_test_direct_file_match_scores_high():
    t = _test("TC-1", "backend/app/services/payment_service.py")
    changed = {"backend/app/services/payment_service.py"}
    score, reasons = svc.score_test(t, changed, risk_scores={})
    assert score >= 40
    assert any(r.matched and "changed" in r.label.lower() for r in reasons)


def test_score_test_no_match_scores_low():
    t = _test("TC-2", "backend/app/services/unrelated.py")
    changed = {"backend/app/services/payment_service.py"}
    score, reasons = svc.score_test(t, changed, risk_scores={})
    assert score < 40
    assert any(not r.matched for r in reasons)


def test_score_test_no_source_file_scores_zero_with_honest_reason():
    t = _test("TC-3", None)
    score, reasons = svc.score_test(t, {"a.py"}, risk_scores={})
    assert score == 0
    assert any("no source file" in r.label.lower() for r in reasons)


def test_score_test_defect_risk_adds_points():
    t = _test("TC-4", "backend/app/services/x.py")
    changed = set()
    score_no_risk, _ = svc.score_test(t, changed, risk_scores={})
    score_with_risk, reasons = svc.score_test(t, changed, risk_scores={"backend/app/services/x.py": 80})
    assert score_with_risk > score_no_risk
    assert any(r.matched and "risk" in r.label.lower() for r in reasons)


def test_score_test_critical_severity_adds_points():
    t_medium = _test("TC-5", "a.py", severity="medium")
    t_critical = _test("TC-6", "a.py", severity="critical")
    changed = set()
    score_medium, _ = svc.score_test(t_medium, changed, risk_scores={})
    score_critical, _ = svc.score_test(t_critical, changed, risk_scores={})
    assert score_critical > score_medium


def test_baseline_test_to_playwright_dict_maps_expect_to_assert_text():
    t = BaselineTest(
        test_id="TC-7", name="n", description="d", category="api",
        steps=[
            BaselineTestStep(action="navigate", target="/login"),
            BaselineTestStep(action="expect", target="h1", assertion="Welcome"),
        ],
    )
    d = svc.baseline_test_to_playwright_dict(t)
    assert d["_id"] == "TC-7"
    assert d["steps"][0]["action"] == "navigate"
    assert d["steps"][0]["selector"] == "/login"
    assert d["steps"][1]["action"] == "assert_text"
    assert d["steps"][1]["selector"] == "h1"
    assert d["steps"][1]["value"] == "Welcome"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_test_selection_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.test_selection_service'`

- [ ] **Step 3: Write the service**

```python
"""
Intelligent Test Selection & Optimization.

Scores every active test in a repo's baseline suite against a commit
range's changed files, blending a direct/proximity file match with the
same defect-risk math `defect_prediction.py` already computes (reused, not
duplicated). Never fabricates a number: if git diff fails or there's no
prior scan to diff against, the whole suite is selected and that fact is
recorded (`diff_available=False`), not silently hidden.
"""
import logging
import math
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from app.models.repo_baseline import BaselineTest
from app.models.test_selection import (
    OptimizationFindingOut, SelectedTest, SelectionReason,
    TestOptimizationReportOut, TestSelectionRun, priority_label,
)
from app.services import baseline_store, diff_service, github_service, repo_service

log = logging.getLogger("test_selection_service")

RUNS_COLLECTION = "test_selection_runs"

_ACTION_MAP = {"expect": "assert_text"}  # BaselineTestStep vocab -> playwright_service vocab


async def compute_file_risk_scores(owner: str, repo: str, since_days: int = 90) -> dict[str, float]:
    """Reuses the exact defect-risk formula from app/routes/defect_prediction.py
    (change frequency 30% + bug-fix ratio 35% + churn 20% + author count 15%),
    returning {filename: risk_score} instead of the top-20 narrative response."""
    try:
        commits = await github_service.get_commits(owner, repo, since_days)
    except Exception as exc:
        log.warning("Test selection: could not fetch commits for risk scoring: %s", exc)
        return {}
    if not commits:
        return {}

    file_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "change_count": 0, "bug_fix_count": 0, "authors": set(), "additions": 0, "deletions": 0,
    })
    bug_keywords = {"fix", "bug", "hotfix", "patch", "defect", "issue", "error", "crash", "regression", "revert"}

    for commit in commits[:50]:
        try:
            detail = await github_service.get_commit_detail(owner, repo, commit["sha"])
            is_bug = any(k in commit["message"].lower() for k in bug_keywords)
            for f in detail.get("files", []):
                fname = f["filename"]
                file_stats[fname]["change_count"] += 1
                if is_bug:
                    file_stats[fname]["bug_fix_count"] += 1
                file_stats[fname]["authors"].add(commit["author"])
                file_stats[fname]["additions"] += f.get("additions", 0)
                file_stats[fname]["deletions"] += f.get("deletions", 0)
        except Exception:
            continue

    if not file_stats:
        return {}

    all_files = list(file_stats.items())
    change_counts = [s["change_count"] for _, s in all_files]
    churn_vals = [(s["additions"] + s["deletions"]) for _, s in all_files]
    author_counts = [len(s["authors"]) for _, s in all_files]
    max_change = max(change_counts) or 1
    max_churn = max(churn_vals) or 1
    max_authors = max(author_counts) or 1

    scores: dict[str, float] = {}
    for filename, stats in all_files:
        bug_ratio = stats["bug_fix_count"] / stats["change_count"] if stats["change_count"] else 0
        risk = (
            (stats["change_count"] / max_change) * 30
            + bug_ratio * 35
            + ((stats["additions"] + stats["deletions"]) / max_churn) * 20
            + (len(stats["authors"]) / max_authors) * 15
        )
        scores[filename] = round(min(risk, 100), 1)
    return scores


def score_test(
    test: BaselineTest, changed_files: set[str], risk_scores: dict[str, float]
) -> tuple[float, list[SelectionReason]]:
    """Deterministic, fully explainable scoring no AI call needed for this,
    every point is traceable to a concrete reason."""
    reasons: list[SelectionReason] = []
    score = 0.0

    if not test.source_file:
        reasons.append(SelectionReason(label="Test has no source file on record cannot be relevance-scored", matched=False))
        return 0.0, reasons

    if test.source_file in changed_files:
        score += 40
        reasons.append(SelectionReason(label=f"{test.source_file} changed", matched=True))
    else:
        changed_dirs = {f.rsplit("/", 1)[0] for f in changed_files if "/" in f}
        test_dir = test.source_file.rsplit("/", 1)[0] if "/" in test.source_file else ""
        if test_dir and test_dir in changed_dirs:
            score += 15
            reasons.append(SelectionReason(label=f"In the same directory as a changed file ({test_dir})", matched=True))
        else:
            reasons.append(SelectionReason(label=f"{test.source_file} not changed and not near a changed file", matched=False))

    risk = risk_scores.get(test.source_file)
    if risk is not None:
        contribution = round(risk * 0.35, 1)
        score += contribution
        reasons.append(SelectionReason(label=f"{test.source_file} carries a defect risk score of {risk} ({contribution} pts)", matched=True))

    if test.severity == "critical":
        score += 10
        reasons.append(SelectionReason(label="Test is marked critical severity", matched=True))
    elif test.severity == "high":
        score += 5
        reasons.append(SelectionReason(label="Test is marked high severity", matched=True))

    return round(min(score, 100), 1), reasons


def baseline_test_to_playwright_dict(test: BaselineTest) -> dict[str, Any]:
    """Adapts a BaselineTest (action/target/value/assertion) into the shape
    playwright_service.execute_playwright_tests / _run_step expects
    (action/selector/value/description)."""
    steps = []
    for s in test.steps:
        action = _ACTION_MAP.get(s.action, s.action)
        steps.append({
            "action": action,
            "selector": s.target,
            "value": s.value or s.assertion or "",
            "description": s.assertion or f"{action} {s.target}",
        })
    return {"_id": test.test_id, "name": test.name, "steps": steps}


async def run_selection(
    db, org_id: str, repo_id: str, github_url: str,
    old_sha: Optional[str] = None, new_sha: Optional[str] = None,
) -> TestSelectionRun:
    baseline = await baseline_store.get_repo(db, org_id, repo_id)
    tests = [t for t in (baseline.tests if baseline else []) if t.is_active]

    owner_repo = github_url.rstrip("/").removesuffix(".git").split("github.com/")[-1]
    owner, _, repo_name = owner_repo.partition("/")

    changed_files: list[str] = []
    diff_available = True
    if old_sha and new_sha:
        repo_path = None
        try:
            repo_path = await asyncio_to_thread_clone(github_url)
            changed_files = await asyncio_to_thread_diff(old_sha, new_sha, repo_path)
            diff_available = bool(changed_files) or old_sha == new_sha
        except Exception as exc:
            log.warning("Test selection: diff failed, falling back to full suite: %s", exc)
            diff_available = False
        finally:
            if repo_path:
                repo_service.cleanup_repo(repo_path)
    else:
        diff_available = False

    risk_scores = await compute_file_risk_scores(owner, repo_name) if owner and repo_name else {}
    changed_set = set(changed_files)

    selected: list[SelectedTest] = []
    for t in tests:
        if diff_available:
            score, reasons = score_test(t, changed_set, risk_scores)
            is_selected = score > 0
        else:
            score, reasons = 100.0, [SelectionReason(label="No diff available full suite selected as a safe fallback", matched=True)]
            is_selected = True
        selected.append(SelectedTest(
            test_id=t.test_id, name=t.name, source_file=t.source_file,
            category=t.category, severity=t.severity, score=score,
            priority=priority_label(score), reasons=reasons, selected=is_selected,
        ))

    selected.sort(key=lambda s: s.score, reverse=True)
    selected_count = sum(1 for s in selected if s.selected)

    run = TestSelectionRun(
        id=str(uuid.uuid4()), org_id=org_id, repo_id=repo_id, github_url=github_url,
        old_sha=old_sha, new_sha=new_sha, changed_files=changed_files,
        diff_available=diff_available, total_tests=len(tests),
        selected_tests=selected, skipped_count=len(tests) - selected_count,
        status="completed",
    )
    return run


async def asyncio_to_thread_clone(github_url: str) -> str:
    import asyncio
    return await asyncio.to_thread(repo_service.clone_repo, github_url)


async def asyncio_to_thread_diff(old_sha: str, new_sha: str, repo_path: str) -> list[str]:
    import asyncio
    return await asyncio.to_thread(diff_service.get_changed_files, old_sha, new_sha, repo_path)


async def save_run(db, run: TestSelectionRun) -> None:
    doc = run.model_dump(by_alias=True)
    await db[RUNS_COLLECTION].replace_one({"_id": doc["_id"], "org_id": doc["org_id"]}, doc, upsert=True)


async def get_run(db, org_id: str, run_id: str) -> Optional[dict]:
    return await db[RUNS_COLLECTION].find_one({"_id": run_id, "org_id": org_id})


async def list_runs(db, org_id: str, limit: int = 20) -> list[dict]:
    cursor = db[RUNS_COLLECTION].find({"org_id": org_id}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def ensure_indexes(db) -> None:
    try:
        await db[RUNS_COLLECTION].create_index([("org_id", 1), ("created_at", -1)])
        await db[RUNS_COLLECTION].create_index([("org_id", 1), ("repo_id", 1)])
    except Exception as exc:
        log.warning("test_selection index creation failed (non-fatal): %s", exc)


async def compute_optimization_report(db, org_id: str, repo_id: str) -> TestOptimizationReportOut:
    """Duplicate + coverage-gap detection are computed from real repo_baselines
    data. Flaky/long-running detection needs per-test execution history that
    doesn't exist yet for baseline tests (they've never been run via
    playwright_service) honestly reported as unavailable, not fabricated."""
    from app.models.repo_baseline import TestCategory

    baseline = await baseline_store.get_repo(db, org_id, repo_id)
    tests = [t for t in (baseline.tests if baseline else []) if t.is_active]

    findings: list[OptimizationFindingOut] = []

    # Duplicate detection: same category + same page_path/endpoint + near-identical name
    buckets: dict[tuple, list[BaselineTest]] = defaultdict(list)
    for t in tests:
        key = (t.category, t.page_path or "", t.endpoint or "")
        buckets[key].append(t)
    duplicate_ids: list[str] = []
    for key, group in buckets.items():
        if len(group) > 1 and (key[1] or key[2]):
            ids = [t.test_id for t in group]
            duplicate_ids.extend(ids)
            findings.append(OptimizationFindingOut(
                kind="duplicate",
                description=f"{len(group)} tests share category '{key[0]}' and target {key[1] or key[2]!r} review for redundancy",
                test_ids=ids,
            ))

    # Coverage gaps: categories with zero active tests
    covered = {t.category for t in tests}
    gap_categories = [c.value for c in TestCategory if c.value not in covered]
    for cat in gap_categories:
        findings.append(OptimizationFindingOut(kind="coverage_gap", description=f"No tests cover category '{cat}'", test_ids=[]))

    findings.append(OptimizationFindingOut(
        kind="flaky", description="Flaky-test detection requires execution history; baseline tests have not yet been executed via the Playwright engine",
        available=False,
    ))
    findings.append(OptimizationFindingOut(
        kind="long_running", description="Long-running-test detection requires execution duration history, not yet available for baseline tests",
        available=False,
    ))

    total_findings = len(duplicate_ids) + len(gap_categories)
    opportunity = "high" if total_findings > 10 else "medium" if total_findings > 3 else "low"

    return TestOptimizationReportOut(
        repo_id=repo_id, total_tests=len(tests),
        potential_duplicates=len(set(duplicate_ids)), coverage_gaps=len(gap_categories),
        flaky_tests=None, long_running_tests=None,
        findings=findings, optimization_opportunity=opportunity,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_test_selection_service.py -v`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/test_selection_service.py backend/tests/test_test_selection_service.py
git commit -m "feat(test-selection): add scoring, selection, optimization, and playwright-adapter service"
```

---

### Task 3: Backend routes + wiring

**Files:**
- Create: `backend/app/routes/test_selection.py`
- Modify: `backend/main.py` (import, router registration, lifespan index block)
- Test: `backend/tests/test_test_selection_routes.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 service functions, existing `app.auth.dependencies.get_current_org`, `app.database.get_db`, `app.services.playwright_service.execute_playwright_tests`.
- Produces: 6 HTTP endpoints under `/api/testing/test-selection` consumed by frontend Task 4.

- [ ] **Step 1: Write the failing route tests**

Use the same real end-to-end test pattern established in the prior plan (real `app_client`/`db` fixtures from `tests/conftest.py`, real org via `organization_service.create_organization`, real session cookie via `create_session_cookie` NOT `patch(get_current_org)`, which does not work against a `Depends()`-bound dependency).

```python
# backend/tests/test_test_selection_routes.py
import pytest
from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_analyze_with_no_baseline_returns_empty_selection(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ts1", name="TS1")
    _cookies(app_client, org.id)
    resp = await app_client.post(
        "/api/testing/test-selection/analyze",
        json={"repo_id": "no-such-repo", "github_url": "https://github.com/x/y"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["total_tests"] == 0
    assert body["diff_available"] is False


@pytest.mark.anyio
async def test_optimization_report_reflects_real_baseline_tests(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ts2", name="TS2")
    _cookies(app_client, org.id)
    await db.repo_baselines.insert_one({
        "_id": "repo1", "org_id": org.id, "github_url": "https://github.com/x/y",
        "sessions": [],
        "tests": [
            {"test_id": "TC-1", "name": "n1", "description": "d", "category": "auth",
             "source_file": "a.py", "severity": "medium", "steps": [], "playwright_code": "",
             "added_in_session": "s1", "is_active": True},
        ],
    })
    resp = await app_client.get("/api/testing/test-selection/optimization", params={"repo_id": "repo1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_tests"] == 1
    assert body["flaky_tests"] is None
    assert any(f["kind"] == "flaky" and f["available"] is False for f in body["findings"])
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_test_selection_routes.py -v`
Expected: FAIL route not registered (404) or module missing.

- [ ] **Step 3: Write the route file**

Write `backend/app/routes/test_selection.py` with 5 endpoints: `POST /analyze`, `GET /history`, `GET /optimization`, `GET /{run_id}`, `POST /{run_id}/execute`. The `/execute` endpoint takes `target_url` in the JSON body (repo_baselines doesn't track a target URL like repo_analyses does, so it must be supplied explicitly), looks up the selection run and the repo_baselines document, converts the selected `BaselineTest`s via `svc.baseline_test_to_playwright_dict`, and dispatches `playwright_service.execute_playwright_tests` as a `BackgroundTasks` job exactly like `root_cause.py`'s `/rerun` endpoint does same pattern, new inputs. Use `_run_to_out(doc)` to shape response dicts, mapping `summary.estimated_savings_pct` from `skipped_count / total_tests * 100` when `total_tests > 0`, else `None`.

Follow the exact `Depends(get_current_org)` + `db=Depends(get_db)` pattern used in every other route file in this codebase (`root_cause.py` is the most recent example). `BackgroundTasks` parameters without defaults must be declared before any `Depends()` parameter that has a default value, per FastAPI's parameter-ordering rules match the ordering already used in `root_cause.py`'s `rerun_test()` route.

- [ ] **Step 4: Wire into `main.py`**

Add `test_selection` to the existing import tuple in `backend/main.py` (alongside `root_cause,` from the prior plan):
```python
from app.routes import (
    requirements, test_cases, test_execution, synthetic_data,
    prioritization, dashboard, repo_analysis,
    github, jira, ci_intelligence, defect_prediction, release_gate,
    monitoring, incidents, sprint,
    workspace, copilot, git_ops, coverage, test_gen,
    pipeline, impact, commit, deployments, prd, cost_logs,
    root_cause, test_selection,
)
```

After the `root_cause.router` registration line, add:
```python
# Intelligent Test Selection & Optimization
app.include_router(test_selection.router, prefix=API_PREFIX)
```

In `lifespan()`, after the `root_cause` index block, add:
```python
    try:
        from app.database import get_db
        from app.services.test_selection_service import ensure_indexes as ensure_ts_indexes
        await ensure_ts_indexes(get_db())
    except Exception as exc:
        print(f"[DB] test_selection index creation failed (non-fatal): {exc}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_test_selection_routes.py -v`
Expected: `2 passed`

- [ ] **Step 6: Run full backend suite**

Run: `cd backend && pytest -v`
Expected: all previously-passing tests (75 from the prior plan) plus these new ones, all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/test_selection.py backend/main.py backend/tests/test_test_selection_routes.py
git commit -m "feat(test-selection): add REST routes and wire into app"
```

---

### Task 4: Frontend API client + hooks

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/hooks/use-test-selection.ts`

**Interfaces:**
- Produces: TS types (`SelectionReason`, `SelectedTestOut`, `TestSelectionSummary`, `TestSelectionRun`, `OptimizationFinding`, `TestOptimizationReport`), `api.analyzeTestSelection`, `api.getTestSelectionRun`, `api.listTestSelectionHistory`, `api.executeTestSelection`, `api.getTestOptimizationReport`; hooks `useTestSelectionHistory()`, `useTestSelectionRun(id)`, `useAnalyzeTestSelection()`, `useExecuteTestSelection(id)`, `useTestOptimizationReport(repoId)` consumed by Task 5.

- [ ] **Step 1: Add types + api methods to `api.ts`**

Add near the Root Cause Analysis block:

```typescript
// ── Intelligent Test Selection types ──
export interface SelectionReason {
  label: string;
  matched: boolean;
}

export interface SelectedTestOut {
  test_id: string;
  name: string;
  source_file: string | null;
  category: string;
  severity: string;
  score: number;
  priority: "critical" | "high" | "medium" | "low";
  reasons: SelectionReason[];
  selected: boolean;
}

export interface TestSelectionSummary {
  total_tests: number;
  relevant_tests: number;
  selected_tests: number;
  skipped_tests: number;
  estimated_savings_pct: number | null;
}

export interface TestSelectionRun {
  id: string;
  repo_id: string;
  github_url: string;
  old_sha: string | null;
  new_sha: string | null;
  changed_files: string[];
  diff_available: boolean;
  summary: TestSelectionSummary;
  tests: SelectedTestOut[];
  status: "completed" | "failed";
  error: string | null;
  created_at: string;
}

export interface OptimizationFinding {
  kind: "duplicate" | "coverage_gap" | "flaky" | "long_running";
  description: string;
  test_ids: string[];
  available: boolean;
}

export interface TestOptimizationReport {
  repo_id: string;
  total_tests: number;
  potential_duplicates: number;
  coverage_gaps: number;
  flaky_tests: number | null;
  long_running_tests: number | null;
  findings: OptimizationFinding[];
  optimization_opportunity: "high" | "medium" | "low";
}
```

Add inside the `api` object:

```typescript
  // ── Intelligent Test Selection ──
  analyzeTestSelection: (repoId: string, githubUrl: string, oldSha?: string, newSha?: string) =>
    apiClient.post<TestSelectionRun>("/testing/test-selection/analyze", {
      repo_id: repoId, github_url: githubUrl, old_sha: oldSha, new_sha: newSha,
    }).then(r => r.data),
  getTestSelectionRun: (id: string) =>
    apiClient.get<TestSelectionRun>(`/testing/test-selection/${id}`).then(r => r.data),
  listTestSelectionHistory: () =>
    apiClient.get<{ runs: TestSelectionRun[] }>("/testing/test-selection/history").then(r => r.data),
  executeTestSelection: (id: string, targetUrl: string) =>
    apiClient.post<{ run_id: string; status: string; test_count: number }>(
      `/testing/test-selection/${id}/execute`, { target_url: targetUrl }
    ).then(r => r.data),
  getTestOptimizationReport: (repoId: string) =>
    apiClient.get<TestOptimizationReport>("/testing/test-selection/optimization", { params: { repo_id: repoId } }).then(r => r.data),
```

- [ ] **Step 2: Create the hooks file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTestSelectionHistory() {
  return useQuery({
    queryKey: ["test-selection", "history"],
    queryFn: () => api.listTestSelectionHistory(),
  });
}

export function useTestSelectionRun(id: string | undefined) {
  return useQuery({
    queryKey: ["test-selection", "detail", id],
    queryFn: () => api.getTestSelectionRun(id as string),
    enabled: !!id,
  });
}

export function useTestOptimizationReport(repoId: string | undefined) {
  return useQuery({
    queryKey: ["test-selection", "optimization", repoId],
    queryFn: () => api.getTestOptimizationReport(repoId as string),
    enabled: !!repoId,
  });
}

export function useAnalyzeTestSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, githubUrl, oldSha, newSha }: { repoId: string; githubUrl: string; oldSha?: string; newSha?: string }) =>
      api.analyzeTestSelection(repoId, githubUrl, oldSha, newSha),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-selection"] });
    },
  });
}

export function useExecuteTestSelection(id: string) {
  return useMutation({
    mutationFn: (targetUrl: string) => api.executeTestSelection(id, targetUrl),
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-test-selection.ts
git commit -m "feat(test-selection): add frontend API client and TanStack Query hooks"
```

---

### Task 5: Dashboard page

**Files:**
- Create: `frontend/src/pages/TestSelection.tsx`

**Interfaces:**
- Consumes: `useTestSelectionHistory`, `useAnalyzeTestSelection`, `useExecuteTestSelection`, `useTestOptimizationReport` (Task 4); `PageShell`, `PageHeader`, `PageStat`, `Badge`, `Button`, `Input` (existing components).
- Produces: default-exported `TestSelection` component consumed by `App.tsx` (Task 6).

- [ ] **Step 1: Write the page**

```tsx
import { useState } from "react";
import { motion } from "framer-motion";
import { ListFilter, Sparkles, Clock, Layers, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/PageShell";
import { PageHeader, PageStat } from "@/components/PageHeader";
import {
  useTestSelectionHistory, useAnalyzeTestSelection,
  useExecuteTestSelection, useTestOptimizationReport,
} from "@/hooks/use-test-selection";

const PRIORITY_STYLE: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-500",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-500",
  medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  low: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
};

export default function TestSelection() {
  const [repoId, setRepoId] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [oldSha, setOldSha] = useState("");
  const [newSha, setNewSha] = useState("");
  const [targetUrl, setTargetUrl] = useState("");

  const { data: history } = useTestSelectionHistory();
  const analyzeMutation = useAnalyzeTestSelection();
  const latestRun = analyzeMutation.data ?? history?.runs?.[0];
  const executeMutation = useExecuteTestSelection(latestRun?.id ?? "");
  const { data: optimization } = useTestOptimizationReport(repoId || latestRun?.repo_id);

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PageHeader
          icon={ListFilter}
          title="Intelligent Test Selection"
          description="Skip the full suite. AI maps your changed files to the tests that actually cover them, explains why, and runs only what matters."
        />
      </motion.div>

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Current Change</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Input placeholder="Repo ID (baseline repo_id)" value={repoId} onChange={(e) => setRepoId(e.target.value)} />
          <Input placeholder="GitHub URL" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
          <Input placeholder="Old commit SHA (optional)" value={oldSha} onChange={(e) => setOldSha(e.target.value)} />
          <Input placeholder="New commit SHA (optional)" value={newSha} onChange={(e) => setNewSha(e.target.value)} />
        </div>
        <Button
          className="mt-4"
          disabled={!repoId || !githubUrl || analyzeMutation.isPending}
          onClick={() => analyzeMutation.mutate({ repoId, githubUrl, oldSha: oldSha || undefined, newSha: newSha || undefined })}
        >
          {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
        </Button>
        {analyzeMutation.isError && (
          <p className="mt-2 text-xs text-destructive">Could not analyze this repo/commit range check the repo ID and URL.</p>
        )}
      </div>

      {latestRun && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PageStat icon={Layers} label="Total Tests" value={latestRun.summary.total_tests} accent="primary" />
            <PageStat icon={Sparkles} label="Selected Tests" value={latestRun.summary.selected_tests} accent="success" />
            <PageStat icon={ListFilter} label="Skipped Tests" value={latestRun.summary.skipped_tests} accent="warning" />
            <PageStat
              icon={Clock}
              label="Estimated Savings"
              value={latestRun.summary.estimated_savings_pct != null ? `${latestRun.summary.estimated_savings_pct}%` : "Not available"}
              accent="destructive"
            />
          </div>

          {!latestRun.diff_available && (
            <div className="floating-card border-yellow-500/30 bg-yellow-500/5 p-4 text-xs text-yellow-700">
              No commit diff was available (missing SHAs, or this is the first scan) the full suite was selected as a safe fallback.
            </div>
          )}

          <div className="floating-card p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[13px] font-semibold tracking-tight">Selected Tests</h2>
              <div className="flex items-center gap-2">
                <Input placeholder="Target app URL to run against" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className="w-64" />
                <Button
                  size="sm"
                  disabled={!targetUrl || executeMutation.isPending}
                  onClick={() => executeMutation.mutate(targetUrl)}
                >
                  {executeMutation.isPending ? "Starting…" : "Execute Selected"}
                </Button>
              </div>
            </div>
            {executeMutation.isSuccess && (
              <p className="mt-2 text-xs text-emerald-500">Execution started ({executeMutation.data.test_count} tests, run {executeMutation.data.run_id.slice(0, 8)}) check Live Test Runner for progress.</p>
            )}
            {executeMutation.isError && (
              <p className="mt-2 text-xs text-destructive">Could not start execution.</p>
            )}
            <div className="mt-4 space-y-2">
              {latestRun.tests.map((t) => (
                <div key={t.test_id} className={`rounded-lg border px-4 py-3 ${t.selected ? "border-border/30 bg-muted/10" : "border-border/10 opacity-60"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{t.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={PRIORITY_STYLE[t.priority]}>{t.priority}</Badge>
                      <span className="text-xs font-semibold text-muted-foreground">{t.score}</span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {t.reasons.map((r, i) => (
                      <p key={i} className={`text-xs ${r.matched ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {r.matched ? "✓" : "○"} {r.label}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {optimization && (
        <div className="floating-card p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight">Test Suite Optimization</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Potential Duplicates</p><p className="font-medium">{optimization.potential_duplicates}</p></div>
            <div><p className="text-xs text-muted-foreground">Coverage Gaps</p><p className="font-medium">{optimization.coverage_gaps}</p></div>
            <div><p className="text-xs text-muted-foreground">Flaky Tests</p><p className="font-medium">{optimization.flaky_tests ?? "Not available"}</p></div>
            <div><p className="text-xs text-muted-foreground">Long-Running Tests</p><p className="font-medium">{optimization.long_running_tests ?? "Not available"}</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Optimization opportunity: <span className="font-semibold uppercase">{optimization.optimization_opportunity}</span></p>
          <div className="mt-4 space-y-2">
            {optimization.findings.filter(f => f.available).map((f, i) => (
              <div key={i} className="rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-xs">{f.description}</div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. If `PageStat`'s `accent` union doesn't include a value used here, check `components/PageHeader.tsx`'s actual type and adjust to a valid value rather than dropping the prop.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TestSelection.tsx
git commit -m "feat(test-selection): add dashboard page"
```

---

### Task 6: Nav + routing wiring, and full regression check

**Files:**
- Modify: `frontend/src/lib/nav-config.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: Add nav item**

Add `ListFilter` to the lucide-react import block in `nav-config.ts`, and append to the `"testing"` section's `items` array (after "AI Root Cause Analysis"):

```ts
{ title: "Intelligent Test Selection", url: "/test-selection", icon: ListFilter, hint: "Change-based test selection" },
```

- [ ] **Step 2: Add route**

In `App.tsx`, add the import `import TestSelection from "@/pages/TestSelection";` and the route `<Route path="/test-selection" element={<TestSelection />} />` inside the `DashboardLayout` block.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Full regression check**

Run: `cd backend && pytest -v` all tests green (75 from prior plans + new ones from this plan).

Manually verify (servers running per `CLAUDE.md`): `/repo-baseline`, `/doc-tests`, `/live-testing`, `/defect-prediction`, `/root-cause`, `/dashboard` all still load without console errors, and the sidebar's "Testing & Quality" group now ends with: ..., Defect Prediction, AI Root Cause Analysis, Intelligent Test Selection.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nav-config.ts frontend/src/App.tsx
git commit -m "feat(test-selection): wire nav item and route"
```

---

## Self-Review Notes

**Spec coverage:** §6-7 (inputs: changed files via diff_service, dependency/impact via direct+proximity file match, defect prediction reused not duplicated, historical data honestly marked unavailable) → Task 2. §8 (prioritization/scoring with explainable factors) → `score_test`. §9 (dashboard: current change, optimization numbers from real data) → Task 5. §10 (per-test explanation) → `SelectionReason` list rendered in the UI. §11 (duplicate/coverage-gap/flaky/long-running optimization, no auto-delete) → `compute_optimization_report`, no destructive action anywhere in this plan. §18 (routes) → Task 3. §21 (integration: reuses Defect Prediction's exact formula, executes via the same Playwright engine Live Test Runner uses) → Tasks 2-3. §23 (real data only) → enforced via `diff_available`/`available` flags and "Not available" UI states throughout.

**Placeholder scan:** no TBD/TODO strings; every code block is complete.

**Type consistency:** `SelectedTestOut`/`TestSelectionRunOut` field names match between backend `_run_to_out()` and frontend `TestSelectionRun`/`SelectedTestOut` interfaces. `OptimizationFindingOut` fields (`kind`, `description`, `test_ids`, `available`) match frontend `OptimizationFinding` exactly. Route paths in Task 3 match Task 4's `apiClient` calls exactly, including `/optimization` and `/{id}/execute`.
