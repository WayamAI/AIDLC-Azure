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
    # Real max score is ~85 (40 direct-match + up to 35 risk + 10 critical-severity),
    # so the "critical" band must sit at/under that to ever be reachable.
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
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


class TestSelectionHistoryOut(BaseModel):
    runs: list[TestSelectionRunOut]


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
