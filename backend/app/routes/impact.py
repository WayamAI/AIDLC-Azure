"""
Code Impact + Test Intelligence API routes.
Exposes the dependency graph, impact-path, file content, and test generation
endpoints consumed by the Code Impact page (Flow 1) and the Document-Driven
Test Generation page (Flow 2).
"""
from __future__ import annotations

import asyncio
import random
import uuid
from pathlib import PurePosixPath
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.models.impact_models import (
    DependencyGraphResponse,
    FileContentRequest,
    FileContentResponse,
    GenerateFromCodeRequest,
    GenerateFromDocsRequest,
    GenerateFromDocsResponse,
    GenerateTestsResponse,
    GraphNode,
    GraphEdge,
    GraphRequest,
    ImpactPathRequest,
    ImpactPathResponse,
    ParseDocsResponse,
    RunTestRequest,
    RunTestResponse,
    TestResult,
)


class WorkspaceGraphRequest(BaseModel):
    workspace_id: str
    file_paths: Optional[List[str]] = None


class WorkspaceGraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]

from app.services import impact_service

router = APIRouter(prefix="/impact", tags=["Code Impact"])

# ── Flow 1 Code-Driven ──────────────────────────────────────────────────────


@router.post("/graph", response_model=DependencyGraphResponse)
async def build_graph(req: GraphRequest, org: OrganizationOut = Depends(get_current_org)):
    """Build a root→leaf dependency graph from PR or commit changes."""
    if not req.pr_number and not req.commit_sha:
        raise HTTPException(status_code=400, detail="Provide pr_number or commit_sha")

    try:
        if req.pr_number:
            changed_files, meta = await impact_service.get_pr_changed_files(
                req.owner, req.repo, req.pr_number
            )
        else:
            changed_files, meta = await impact_service.get_commit_changed_files(
                req.owner, req.repo, req.commit_sha  # type: ignore[arg-type]
            )

        if not changed_files:
            raise HTTPException(status_code=404, detail="No relevant changed files found in this PR/commit")

        ref = changed_files[0].get("ref") or req.commit_sha or "HEAD"
        nodes, edges, tree = await impact_service.build_dependency_graph(
            req.owner, req.repo, changed_files, ref
        )

        changed_paths = [f["path"] for f in changed_files]
        impacted_paths = [n.path for n in nodes if n.is_impacted]

        return DependencyGraphResponse(
            nodes=nodes,
            edges=edges,
            tree=tree,
            changed_files=changed_paths,
            impacted_files=impacted_paths,
            pr_title=meta.get("title"),
            pr_url=meta.get("url"),
            commit_message=meta.get("title"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/impact-path", response_model=ImpactPathResponse)
async def get_impact_path(req: ImpactPathRequest, org: OrganizationOut = Depends(get_current_org)):
    """Compute the root→leaf impact chain through a focus file."""
    result = impact_service.compute_impact_path(req.nodes, req.edges, req.focus_file)
    return ImpactPathResponse(**result)


@router.post("/file-content", response_model=FileContentResponse)
async def get_file_content(req: FileContentRequest, org: OrganizationOut = Depends(get_current_org)):
    """Fetch raw file content from GitHub for display in the code viewer."""
    content = await impact_service.fetch_file_content(
        req.owner, req.repo, req.path, req.ref
    )
    ext_lang_map = {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".py": "python",
        ".vue": "vue",
        ".md": "markdown",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".css": "css",
        ".scss": "scss",
    }
    ext = PurePosixPath(req.path).suffix
    language = ext_lang_map.get(ext, "plaintext")
    return FileContentResponse(path=req.path, content=content, language=language)


@router.post("/generate-from-code", response_model=GenerateTestsResponse)
async def generate_from_code(req: GenerateFromCodeRequest, org: OrganizationOut = Depends(get_current_org)):
    """AI-generate test cases from a file's content and its impact context."""
    ext_map = {
        ".ts": "TypeScript/Jest",
        ".tsx": "TypeScript/Jest",
        ".js": "JavaScript/Jest",
        ".jsx": "JavaScript/Jest",
        ".py": "Python/pytest",
        ".vue": "Vue/Vitest",
    }
    ext = PurePosixPath(req.file_path).suffix
    framework = ext_map.get(ext, "Jest")

    try:
        tests = await impact_service.generate_tests_from_code(
            req.file_path,
            req.file_content,
            req.language,
            req.impact_context,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return GenerateTestsResponse(tests=tests, framework=framework, file_path=req.file_path)


# ── Flow 2 Document-Driven ─────────────────────────────────────────────────


@router.post("/upload-doc", response_model=ParseDocsResponse)
async def upload_doc(file: UploadFile = File(...), org: OrganizationOut = Depends(get_current_org)):
    """Upload a document (text/PDF/DOCX) and extract testable scenarios with AI."""
    raw = await file.read()
    try:
        content = raw.decode("utf-8", errors="replace")
    except Exception:
        content = raw.decode("latin-1", errors="replace")

    try:
        scenarios = await impact_service.parse_document_to_scenarios(
            content, file.filename or "document"
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return ParseDocsResponse(scenarios=scenarios, total=len(scenarios))


@router.post("/generate-from-docs", response_model=GenerateFromDocsResponse)
async def generate_from_docs(req: GenerateFromDocsRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate test cases from document-extracted scenarios."""
    try:
        tests = await impact_service.generate_tests_from_scenarios(
            req.scenarios, req.framework
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return GenerateFromDocsResponse(tests=tests, total=len(tests))


# ── Shared Test Execution (mock runner) ─────────────────────────────────────


@router.post("/run-tests", response_model=RunTestResponse)
async def run_tests(req: RunTestRequest, org: OrganizationOut = Depends(get_current_org)):
    """
    Simulate test execution.
    In production this would delegate to a real test runner sandbox.
    """
    await asyncio.sleep(random.uniform(0.3, 1.2))

    status = random.choices(["passed", "failed"], weights=[80, 20])[0]
    duration = random.randint(40, 600)

    result = TestResult(
        test_id=req.test_id,
        test_name=f"Test {req.test_id[:8]}",
        status=status,
        duration_ms=duration,
        error=(
            None
            if status == "passed"
            else "AssertionError: expected value did not match actual"
        ),
        output=f"✓ Executed in {duration}ms" if status == "passed" else None,
    )

    results: List[TestResult] = [result]
    passed = sum(1 for r in results if r.status == "passed")
    failed = len(results) - passed

    return RunTestResponse(
        results=results,
        passed=passed,
        failed=failed,
        total=len(results),
        pass_rate=passed / len(results) if results else 0.0,
    )


# ── Batch test execution ───────────────────────────────────────────────────────


@router.post("/run-all-tests")
async def run_all_tests(test_ids: List[str], org: OrganizationOut = Depends(get_current_org)):
    """Run multiple tests concurrently and aggregate results."""
    async def _run_one(test_id: str) -> TestResult:
        await asyncio.sleep(random.uniform(0.1, 0.8))
        status = random.choices(["passed", "failed"], weights=[80, 20])[0]
        duration = random.randint(40, 600)
        return TestResult(
            test_id=test_id,
            test_name=f"Test {test_id[:8]}",
            status=status,
            duration_ms=duration,
            error=None if status == "passed" else "AssertionError: expected ≠ actual",
            output=f"✓ {duration}ms" if status == "passed" else None,
        )

    results = await asyncio.gather(*[_run_one(tid) for tid in test_ids])
    results_list: List[TestResult] = list(results)
    passed = sum(1 for r in results_list if r.status == "passed")
    failed = len(results_list) - passed

    return RunTestResponse(
        results=results_list,
        passed=passed,
        failed=failed,
        total=len(results_list),
        pass_rate=passed / len(results_list) if results_list else 0.0,
    )


# ── Workspace dependency graph (local clone) ──────────────────────────────────


@router.post("/workspace-graph", response_model=WorkspaceGraphResponse)
async def build_workspace_graph(req: WorkspaceGraphRequest, org: OrganizationOut = Depends(get_current_org)):
    """
    Build a root→leaf dependency graph from a cloned workspace.
    Pass file_paths to focus on specific changed files (from git status);
    omit to analyse the entire workspace.
    """
    try:
        nodes, edges = impact_service.build_workspace_dependency_graph(
            req.workspace_id, req.file_paths
        )
        return WorkspaceGraphResponse(nodes=nodes, edges=edges)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
