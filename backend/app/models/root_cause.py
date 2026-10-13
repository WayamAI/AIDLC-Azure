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
    analysis_id: Optional[str] = None
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
    analysis_id: Optional[str] = None
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


class RootCauseListResponse(BaseModel):
    summary: RootCauseSummaryOut
    items: list[RootCauseListItemOut]


class UnanalyzedFailuresResponse(BaseModel):
    failures: list[UnanalyzedFailureOut]


class RerunOut(BaseModel):
    run_id: str
    status: str
