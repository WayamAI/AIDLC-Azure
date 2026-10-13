"""Test generation routes generate + run tests."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.workspace_models import (
    TestGenerateRequest, TestGenerateResponse,
    PlaywrightGenerateRequest, PlaywrightGenerateResponse,
    GeneratedPlaywrightTest,
    PlaywrightBatchGenerateRequest,
    PlaywrightAppGenerateRequest,
    PlaywrightCommitGenerateRequest,
    SaveTestSuiteRequest, TestSuiteInfo,
    ChainAnalyzeRequest, ChainAnalyzeResponse,
)
from app.routes.deps import attach_workspace
from app.services import test_gen_service

router = APIRouter(prefix="/tests", tags=["Test Generation"])


@router.post("/generate", response_model=TestGenerateResponse)
async def generate_tests(req: TestGenerateRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate pytest/jest test cases for coverage gaps using AI."""
    result = await test_gen_service.generate_tests(
        workspace_id=req.workspace_id,
        file_path=req.file_path,
        content=req.content,
        gaps=req.gaps,
        framework=req.framework,
        existing_tests=req.existing_tests,
    )
    return result


@router.post("/generate-playwright", response_model=PlaywrightGenerateResponse)
async def generate_playwright_tests(req: PlaywrightGenerateRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate structured Playwright test cases from a source file using AI."""
    result = await test_gen_service.generate_playwright_tests(
        workspace_id=req.workspace_id,
        file_path=req.file_path,
        content=req.content,
        target_url=req.target_url,
            num_tests=req.num_tests,
    )
    return result


class ExportPlaywrightRequest(PlaywrightGenerateRequest):
    """Reuse base fields but swap content for tests list."""
    pass


from pydantic import BaseModel
from typing import Optional, List


class _ExportReq(BaseModel):
    workspace_id: str
    tests: List[GeneratedPlaywrightTest]
    target_url: Optional[str] = None


class _ExportResp(BaseModel):
    file_path: str
    content: str


@router.post("/export-playwright", response_model=_ExportResp)
async def export_playwright_tests(req: _ExportReq, org: OrganizationOut = Depends(get_current_org)):
    """Convert PlaywrightTestCase objects to a .spec.ts file and return the content."""
    content = test_gen_service.export_playwright_tests_as_spec(
        tests=[t.model_dump() for t in req.tests],
        target_url=req.target_url,
    )
    return {"file_path": "tests/e2e/generated.spec.ts", "content": content}


# ── Batch / App / Commit generation ────────────────────────────────────────

@router.post("/generate-playwright-batch", response_model=PlaywrightGenerateResponse)
async def generate_playwright_batch(req: PlaywrightBatchGenerateRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate Playwright tests for multiple files at once (virtual/dirty files)."""
    result = await test_gen_service.generate_playwright_tests_batch(
        files=[f.model_dump() for f in req.files],
        target_url=req.target_url,
    )
    return result


@router.post("/generate-playwright-app", response_model=PlaywrightGenerateResponse, dependencies=[Depends(attach_workspace)])
async def generate_playwright_app(req: PlaywrightAppGenerateRequest, org: OrganizationOut = Depends(get_current_org)):
    """Scan entire workspace and generate Playwright tests for the most important files."""
    try:
        result = await test_gen_service.generate_playwright_tests_for_app(
            workspace_id=req.workspace_id,
            target_url=req.target_url,
            org_id=org.id,
        )
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/generate-playwright-commit", response_model=PlaywrightGenerateResponse, dependencies=[Depends(attach_workspace)])
async def generate_playwright_commit(req: PlaywrightCommitGenerateRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate Playwright tests for files changed in a specific git commit."""
    try:
        result = await test_gen_service.generate_playwright_tests_for_commit(
            workspace_id=req.workspace_id,
            commit_sha=req.commit_sha,
            target_url=req.target_url,
            org_id=org.id,
        )
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Chain Analysis ─────────────────────────────────────────────────────────

@router.post("/analyze-chain", response_model=ChainAnalyzeResponse, dependencies=[Depends(attach_workspace)])
async def analyze_chain(req: ChainAnalyzeRequest, org: OrganizationOut = Depends(get_current_org)):
    """Use AI to analyse each file in a root→leaf chain and suggest test counts."""
    try:
        analyses = await test_gen_service.analyze_chain_for_tests(
            workspace_id=req.workspace_id,
            chain=req.chain,
            changed_files=req.changed_files,
            org_id=org.id,
        )
        return {"analyses": analyses}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Suite persistence ───────────────────────────────────────────────────────

@router.post("/workspace-suites", response_model=TestSuiteInfo)
async def save_test_suite(
    req: SaveTestSuiteRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Save a generated test suite to the database."""
    return await test_gen_service.save_test_suite(
        db,
        org.id,
        workspace_id=req.workspace_id,
        name=req.name,
        scope=req.scope,
        tests=req.tests,
        target_url=req.target_url,
        commit_sha=req.commit_sha,
    )


@router.get("/workspace-suites", response_model=list[TestSuiteInfo])
async def list_test_suites(
    workspace_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """List saved test suites for a workspace."""
    return await test_gen_service.list_test_suites(db, org.id, workspace_id)


@router.get("/workspace-suites/{suite_id}")
async def get_test_suite(
    suite_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Get full test suite including test cases."""
    suite = await test_gen_service.get_test_suite(db, org.id, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    return suite


@router.delete("/workspace-suites/{suite_id}")
async def delete_test_suite(
    suite_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Delete a saved test suite."""
    if not await test_gen_service.delete_test_suite(db, org.id, suite_id):
        raise HTTPException(status_code=404, detail="Suite not found")
    return {"deleted": True}
