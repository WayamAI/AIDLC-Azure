from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.models.requirement import PyObjectId


PriorityStatus = Literal["failed", "warning", "stable"]


class PrioritizedTest(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    tc_id: str
    name: str
    failure_count: int
    severity: str
    priority: int           # 0-100
    status: PriorityStatus
    known_failure: bool

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}


class PrioritizedTestOut(BaseModel):
    id: str
    tc_id: str
    name: str
    failure_count: int
    severity: str
    priority: int
    status: PriorityStatus
    known_failure: bool
