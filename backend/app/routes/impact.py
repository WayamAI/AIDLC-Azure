"""
Code Impact + Test Intelligence API routes.
Exposes the dependency graph, impact-path, file content, and test generation
endpoints consumed by the Code Impact page (Flow 1) and the Document-Driven
Test Generation page (Flow 2).
"""
from __future__ import annotations

import asyncio
import io
import logging
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
    TestResult,
)


class WorkspaceGraphRequest(BaseModel):
    workspace_id: str
    file_paths: Optional[List[str]] = None


class WorkspaceGraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]

from app.routes.deps import attach_workspace
from app.services import impact_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/impact", tags=["Code Impact"])

# ── Flow 1 Code-Driven ──────────────────────────────────────────────────────


@router.post("/graph", response_model=DependencyGraphResponse)
async def build_graph(req: GraphRequest, org: OrganizationOut = Depends(get_current_org)):
    """Build a root→leaf dependency graph from PR or commit changes."""
    if not req.pr_number and not req.commit_sha:
        raise HTTPException(status_code=400, detail="Provide pr_number or commit_sha")

    if req.pr_number:
        changed_files, meta = await impact_service.get_pr_changed_files(
            req.owner, req.repo, req.pr_number
        )
    else:
        changed_files, meta = await impact_service.get_commit_changed_files(
            req.owner, req.repo, req.commit_sha  # type: ignore[arg-type]
        )

    if not changed_files:
        return DependencyGraphResponse(
            nodes=[],
            edges=[],
            tree={},
            changed_files=[],
            impacted_files=[],
            pr_title=meta.get("title"),
            pr_url=meta.get("url"),
            commit_message=meta.get("title"),
            message="This commit/PR has no source files to graph (.ts/.tsx/.js/.py).",
        )

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

    tests = await impact_service.generate_tests_from_code(
        req.file_path,
        req.file_content,
        req.language,
        req.impact_context,
    )

    return GenerateTestsResponse(tests=tests, framework=framework, file_path=req.file_path)


# ── Flow 2 Document-Driven ─────────────────────────────────────────────────


_TEXT_DOC_EXTENSIONS = {".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".csv"}


def extract_document_text(filename: str, raw: bytes) -> str:
    """
    Return the plain text of an uploaded document.

    Raises HTTPException 415 for formats that cannot be read and 422 when the
    file is readable but yields no text.
    """
    ext = PurePosixPath(filename.replace("\\", "/")).suffix.lower()

    if ext == ".pdf":
        text = _extract_pdf_text(raw)
    elif ext == ".docx":
        text = _extract_docx_text(raw)
    elif ext == ".doc":
        raise HTTPException(
            status_code=415,
            detail="Legacy .doc files are not supported. Save the document as .docx or PDF and upload it again.",
        )
    elif ext in _TEXT_DOC_EXTENSIONS or not ext:
        text = _decode_text(raw)
    else:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Upload a PDF, DOCX, or a text file (.txt, .md, .json, .yaml, .csv).",
        )

    text = text.strip()
    if not text:
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from this document. If it is a scanned PDF, upload a text-based version.",
        )
    return text


def _decode_text(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass
    if b"\x00" in raw:
        raise HTTPException(
            status_code=415,
            detail="This file looks like binary data, not text. Upload a PDF, DOCX, or a text file.",
        )
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _extract_pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted and not reader.decrypt(""):
            raise HTTPException(status_code=422, detail="This PDF is password-protected and cannot be read.")
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except (PyPdfError, ValueError, OSError, KeyError) as exc:
        raise HTTPException(status_code=422, detail="This file is not a readable PDF.") from exc


def _extract_docx_text(raw: bytes) -> str:
    import zipfile

    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError

    try:
        document = Document(io.BytesIO(raw))
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="This file is not a readable DOCX document.") from exc

    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(part for part in parts if part.strip())


_MAX_DOC_UPLOAD_BYTES = 20 * 1024 * 1024


@router.post("/upload-doc", response_model=ParseDocsResponse)
async def upload_doc(file: UploadFile = File(...), org: OrganizationOut = Depends(get_current_org)):
    """Upload a document (text/PDF/DOCX) and extract testable scenarios with AI."""
    # Read one byte past the limit so an oversized file is detected without buffering all of it.
    raw = await file.read(_MAX_DOC_UPLOAD_BYTES + 1)
    if len(raw) > _MAX_DOC_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The document is larger than 20 MB. Upload a smaller file.")
    content = await asyncio.to_thread(extract_document_text, file.filename or "", raw)

    scenarios = await impact_service.parse_document_to_scenarios(
        content, file.filename or "document"
    )

    return ParseDocsResponse(scenarios=scenarios, total=len(scenarios))


@router.post("/generate-from-docs", response_model=GenerateFromDocsResponse)
async def generate_from_docs(req: GenerateFromDocsRequest, org: OrganizationOut = Depends(get_current_org)):
    """Generate test cases from document-extracted scenarios."""
    tests = await impact_service.generate_tests_from_scenarios(
        req.scenarios, req.framework
    )

    return GenerateFromDocsResponse(tests=tests, total=len(tests))


# ── Shared Test Execution (mock runner) ─────────────────────────────────────


@router.post("/workspace-graph", response_model=WorkspaceGraphResponse, dependencies=[Depends(attach_workspace)])
async def build_workspace_graph(req: WorkspaceGraphRequest, org: OrganizationOut = Depends(get_current_org)):
    """
    Build a root→leaf dependency graph from a cloned workspace.
    Pass file_paths to focus on specific changed files (from git status);
    omit to analyse the entire workspace.
    """
    try:
        nodes, edges = await asyncio.to_thread(
            impact_service.build_workspace_dependency_graph,
            req.workspace_id,
            req.file_paths,
            org_id=org.id,
        )
        return WorkspaceGraphResponse(nodes=nodes, edges=edges)
    except (ValueError, KeyError) as exc:
        # require_workspace raises KeyError for unknown/other-org workspaces;
        # that is a 404, not a server error.
        raise HTTPException(status_code=404, detail="Workspace not found") from exc
    except Exception as exc:
        log.exception("Failed to build workspace graph for %s", req.workspace_id)
        raise HTTPException(status_code=500, detail=f"Failed to build dependency graph: {exc}") from exc
