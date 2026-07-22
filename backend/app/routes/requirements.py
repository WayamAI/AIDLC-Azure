from fastapi import APIRouter, HTTPException
from app.models.requirement import RequirementCreate
from app.services import requirement_service
from app.services.ai_service import AIQuotaError

router = APIRouter(prefix="/requirements", tags=["Requirements"])


@router.post("", status_code=201)
async def analyze_requirement(body: RequirementCreate):
    """
    Submit a software requirement. Ollama generates test cases automatically.
    Returns the new requirement with a summary of generated tests.
    """
    try:
        result = await requirement_service.create_requirement(body.text, body.instructions)
        return result
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("")
async def list_requirements(skip: int = 0, limit: int = 20):
    requirements = await requirement_service.list_requirements(skip=skip, limit=limit)
    return requirements
