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


class TestResultOut(BaseModel):
    id: str
    tc_id: str
    name: str
    status: StatusType
    duration: float
    error_message: Optional[str]
    run_id: str
    timestamp: datetime


class RunStarted(BaseModel):
    """Returned immediately by POST /run execution continues in the background."""
    run_id: str
    total: int


class RunSummary(BaseModel):
    run_id: str
    total: int
    passed: int
    failed: int
    skipped: int
    success_rate: float
    total_duration: float
    started_at: datetime
