"""
Generic synthetic dataset model schema and rows are driven by the requirement, not hardcoded.
"""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field
from app.models.requirement import PyObjectId


class SchemaField(BaseModel):
    """One column in the AI-designed schema."""
    name: str
    type: str          # "string" | "integer" | "float" | "boolean" | "datetime"
    description: str


class SyntheticDataset(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    requirement_id: str
    requirement_text: str
    count: int
    schema_fields: list[SchemaField]
    rows: list[dict[str, Any]]
    generated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}


class SyntheticDatasetOut(BaseModel):
    id: str
    requirement_id: str
    requirement_text: str
    count: int
    schema_fields: list[SchemaField]
    rows: list[dict[str, Any]]
    generated_at: datetime


class GenerateSyntheticRequest(BaseModel):
    requirement_id: str
    count: int = Field(default=20, ge=1, le=100)
