from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from app.models.synthetic_data import GenerateSyntheticRequest, SyntheticDatasetOut, SchemaField
from app.services import synthetic_data_service
from app.services import ai_service
from app.services.ai_service import AIQuotaError
from app.database import get_db
from bson import ObjectId
from typing import Any

router = APIRouter(prefix="/synthetic-data", tags=["Synthetic Data"])


class PreviewRequest(BaseModel):
    requirement_id: str
    count: int = Field(default=20, ge=1, le=100)


class PreviewResponse(BaseModel):
    schema_fields: list[SchemaField]
    rows: list[dict[str, Any]]


@router.post("/preview", status_code=200, response_model=PreviewResponse)
async def preview_synthetic_data(body: PreviewRequest):
    """
    Generate a dataset for a requirement WITHOUT storing it.
    Returns schema_fields + rows so the UI can show an editable preview.
    """
    try:
        db = get_db()
        req_doc = await db.requirements.find_one({"_id": ObjectId(body.requirement_id)})
        if not req_doc:
            raise HTTPException(status_code=404, detail=f"Requirement '{body.requirement_id}' not found")
        requirement_text: str = req_doc["text"]
        result = await ai_service.generate_requirement_based_data(requirement_text, body.count)
        raw_schema: list[dict] = result.get("schema", [])
        rows: list[dict] = result.get("rows", [])
        schema_fields = [SchemaField(**f) for f in raw_schema]
        return PreviewResponse(schema_fields=schema_fields, rows=rows)
    except HTTPException:
        raise
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate", status_code=201, response_model=SyntheticDatasetOut)
async def generate_synthetic_data(body: GenerateSyntheticRequest):
    """
    Generate AI-driven test data for the given requirement.
    Gemini designs the schema and fills the rows based on the requirement text.
    """
    try:
        dataset = await synthetic_data_service.generate_and_store(
            requirement_id=body.requirement_id,
            count=body.count,
        )
        return dataset
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("", response_model=list[SyntheticDatasetOut])
async def get_synthetic_datasets(limit: int = Query(default=10, le=50)):
    """Return the most recently generated datasets."""
    return await synthetic_data_service.get_datasets(limit=limit)

