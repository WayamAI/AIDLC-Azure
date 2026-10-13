"""
Self-Healing Tests models.

A healing attempt starts from one failed step of one test in a
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
    selector: Optional[str] = None  # None = no safe candidate found
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
    healing_success_rate: Optional[float] = None
