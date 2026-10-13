from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.models.requirement import PyObjectId


StatusType = Literal["PASS", "FAIL", "SKIP"]


class TestResult(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    tc_id: str
    name: str
    status: StatusType
    duration: float          # seconds
    error_message: Optional[str] = None
    run_id: str              # groups a single execution run
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}


class StepOut(BaseModel):
    action: Optional[str] = None
    description: Optional[str] = None
    status: str                      # pass | fail | not_run
    error: Optional[str] = None


class TestResultOut(BaseModel):
    id: str
    tc_id: str
    name: str
    status: StatusType
    duration: float
    error_message: Optional[str]
    run_id: str
    timestamp: datetime
    category: Optional[str] = None
    severity: Optional[str] = None
    skip_reason: Optional[str] = None
    steps: list[StepOut] = []
    screenshot: Optional[str] = None  # base64 JPEG of the failing (or final) step


class RunRequest(BaseModel):
    requirement_id: str = Field(min_length=1)
    target_url: str = Field(min_length=1, max_length=2000)
    username: Optional[str] = Field(default=None, max_length=320)
    password: Optional[str] = Field(default=None, max_length=256)
    replan: bool = False             # discard saved plans and plan every case again
    replan_skipped: bool = False     # plan again only the cases saved as not automatable


class RunStarted(BaseModel):
    """Returned immediately by POST /run; execution continues in the background."""
    run_id: str
    total: int


class RunSummary(BaseModel):
    run_id: str
    status: Literal["running", "completed", "failed"]
    phase: Optional[str] = None
    error: Optional[str] = None
    target_url: str
    requirement_id: Optional[str] = None
    plans_reused: int = 0
    plans_created: int = 0
    total: int
    completed: int
    passed: int
    failed: int
    skipped: int
    # passed / (passed + failed); skipped cases were not checked. None when no case
    # was executed, which is not the same as 0%.
    success_rate: Optional[float] = None
    total_duration: float
    started_at: datetime
    completed_at: Optional[datetime] = None
