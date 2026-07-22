"""
PRD Generator routes.
POST /prd/generate  AI-powered PRD generation from product name + description.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import prd_service
from app.services.ai_service import AIQuotaError

router = APIRouter(prefix="/prd", tags=["PRD Generator"])


class PRDGenerateRequest(BaseModel):
    product_name: str
    description: str


@router.post("/generate", status_code=200)
async def generate_prd(body: PRDGenerateRequest):
    """
    Generate a structured Product Requirements Document using AI.
    Returns a full PRD with use cases, user stories, functional requirements,
    non-functional requirements, out-of-scope items, and success metrics.
    """
    if not body.product_name.strip():
        raise HTTPException(status_code=422, detail="product_name is required")
    if not body.description.strip():
        raise HTTPException(status_code=422, detail="description is required")

    try:
        result = await prd_service.generate_prd(
            product_name=body.product_name.strip(),
            description=body.description.strip(),
        )
        return result
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
