from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field, ValidationError
from app.auth.dependencies import get_current_org
from app.models.synthetic_data import GenerateSyntheticRequest, SyntheticDatasetOut, SchemaField
from app.models.organization import OrganizationOut
from app.services import synthetic_data_service
from app.services import ai_service
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
async def preview_synthetic_data(
    body: PreviewRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Generate a dataset for a requirement WITHOUT storing it.
    Returns schema_fields + rows so the UI can show an editable preview.
    """
    req_doc = None
    if ObjectId.is_valid(body.requirement_id):
        req_doc = await db.requirements.find_one({"_id": ObjectId(body.requirement_id), "org_id": org.id})
    if not req_doc:
        raise HTTPException(status_code=404, detail=f"Requirement '{body.requirement_id}' not found")
    requirement_text: str = req_doc["text"]
    result = await ai_service.generate_requirement_based_data(requirement_text, body.count)
    try:
        schema_fields = [SchemaField(**f) for f in result["schema"]]
        rows = [r for r in result["rows"] if isinstance(r, dict)]
    except (KeyError, TypeError, ValueError) as exc:
        raise ai_service.AIResponseError(f"The AI model returned a malformed dataset: {exc}") from exc
    return PreviewResponse(schema_fields=schema_fields, rows=rows)


@router.post("/generate", status_code=201, response_model=SyntheticDatasetOut)
async def generate_synthetic_data(
    body: GenerateSyntheticRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Generate AI-driven test data for the given requirement.
    Gemini designs the schema and fills the rows based on the requirement text.
    """
    try:
        dataset = await synthetic_data_service.generate_and_store(
            db,
            org.id,
            requirement_id=body.requirement_id,
            count=body.count,
        )
        return dataset
    except ValidationError as exc:
        # pydantic's ValidationError is a ValueError, so it must be caught before the 404 branch.
        raise HTTPException(status_code=502, detail="The model returned malformed data") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("", response_model=list[SyntheticDatasetOut])
async def get_synthetic_datasets(
    limit: int = Query(default=10, le=50),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Return the most recently generated datasets."""
    return await synthetic_data_service.get_datasets(db, org.id, limit=limit)
