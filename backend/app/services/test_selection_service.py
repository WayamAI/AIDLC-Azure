"""
Intelligent Test Selection & Optimization.

Scores every active test in a repo's baseline suite against a commit
range's changed files, blending a direct/proximity file match with the
same defect-risk math `defect_prediction.py` already computes (reused, not
duplicated). Never fabricates a number: if git diff fails or there's no
prior scan to diff against, the whole suite is selected and that fact is
recorded (`diff_available=False`), not silently hidden.
"""
import asyncio
import logging
import uuid
from collections import defaultdict
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

    # Budget scales with auth: 50 with a token, far fewer without, so one run
    # cannot burn an unauthenticated 60/hour quota. See github_service.
    for commit in commits[:github_service.commit_detail_budget()]:
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
) -> tuple[float, list[SelectionReason], bool]:
    """Deterministic, fully explainable scoring no AI call needed for this,
    every point is traceable to a concrete reason.

    Returns (score, reasons, has_relevance_signal). `has_relevance_signal` is
    True only for a direct file match or a same-directory/proximity match —
    risk-score and severity contribute to `score` for ranking purposes but
    must NOT, on their own, make a test relevant to the diff."""
    reasons: list[SelectionReason] = []
    score = 0.0
    has_relevance_signal = False

    if not test.source_file:
        reasons.append(SelectionReason(label="Test has no source file on record cannot be relevance-scored", matched=False))
        return 0.0, reasons, False

    if test.source_file in changed_files:
        score += 40
        has_relevance_signal = True
        reasons.append(SelectionReason(label=f"{test.source_file} changed", matched=True))
    else:
        reasons.append(SelectionReason(label=f"{test.source_file} not changed", matched=False))
        changed_dirs = {f.rsplit("/", 1)[0] for f in changed_files if "/" in f}
        test_dir = test.source_file.rsplit("/", 1)[0] if "/" in test.source_file else ""
        if test_dir and test_dir in changed_dirs:
            score += 15
            has_relevance_signal = True
            reasons.append(SelectionReason(label=f"In the same directory as a changed file ({test_dir})", matched=True))

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

    return round(min(score, 100), 1), reasons, has_relevance_signal


def baseline_test_to_playwright_dict(test: BaselineTest) -> dict[str, Any]:
    """Adapts a BaselineTest (action/target/value/assertion) into the shape
    playwright_service.execute_playwright_tests / _run_step expects
    (action/selector/value/description)."""
    steps = []
    for s in test.steps:
        action = _ACTION_MAP.get(s.action, s.action)
        if action == "navigate":
            # _run_step's navigate branch reads the destination from `value`,
            # not `selector` selector is unused for this action. `target`
            # holds the URL/path for navigate steps.
            selector = None
            value = s.target or ""
        elif action == "assert_text":
            selector = s.target
            value = s.value or s.assertion or ""
        else:
            selector = s.target
            # Only assert_text should ever fall back to `assertion`; other
            # actions (e.g. `wait`) must not inherit a non-numeric string here.
            value = s.value or ""
        steps.append({
            "action": action,
            "selector": selector,
            "value": value,
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
            # get_changed_files now raises when git cannot diff, so reaching here
            # means the result is real — an empty list is genuinely "no files
            # changed", not a failure, and must not trigger the full-suite fallback.
            diff_available = True
        except Exception as exc:
            log.warning("Test selection: diff failed, falling back to full suite: %s", exc)
            changed_files = []
            diff_available = False
        finally:
            if repo_path:
                await asyncio_to_thread_cleanup(repo_path)
    else:
        diff_available = False

    risk_scores = await compute_file_risk_scores(owner, repo_name) if owner and repo_name else {}
    changed_set = set(changed_files)

    selected: list[SelectedTest] = []
    for t in tests:
        if diff_available:
            score, reasons, has_relevance_signal = score_test(t, changed_set, risk_scores)
            is_selected = has_relevance_signal
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
    # with_history: this clone gets diffed between two SHAs, which a depth-1
    # clone cannot do.
    return await asyncio.to_thread(repo_service.clone_repo, github_url, with_history=True)


async def asyncio_to_thread_diff(old_sha: str, new_sha: str, repo_path: str) -> list[str]:
    return await asyncio.to_thread(diff_service.get_changed_files, old_sha, new_sha, repo_path)


async def asyncio_to_thread_cleanup(repo_path: str) -> None:
    await asyncio.to_thread(repo_service.cleanup_repo, repo_path)


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
