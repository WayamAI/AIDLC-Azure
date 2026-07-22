"""Pydantic models for the Code Impact + Test Intelligence platform."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


# ── Graph ──────────────────────────────────────────────────────────────────────

class GraphRequest(BaseModel):
    owner: str
    repo: str
    pr_number: Optional[int] = None
    commit_sha: Optional[str] = None


class GraphNode(BaseModel):
    id: str
    path: str
    name: str
    ext: str
    is_changed: bool = False
    is_impacted: bool = False
    layer: int = 0
    layer_index: int = 0
    x: float = 0
    y: float = 0


class GraphEdge(BaseModel):
    source: str
    target: str


class DependencyGraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    tree: Dict[str, Any]
    changed_files: List[str]
    impacted_files: List[str]
    pr_title: Optional[str] = None
    pr_url: Optional[str] = None
    commit_message: Optional[str] = None


# ── File content ───────────────────────────────────────────────────────────────

class FileContentRequest(BaseModel):
    owner: str
    repo: str
    path: str
    ref: Optional[str] = None


class FileContentResponse(BaseModel):
    path: str
    content: str
    language: str


# ── Impact analysis ────────────────────────────────────────────────────────────

class ImpactPathRequest(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    focus_file: str


class ImpactPathResponse(BaseModel):
    focus_file: str
    root_path: List[str]   # path from root → focus file
    leaf_path: List[str]   # path from focus file → leaves
    full_path: List[str]   # root → focus → leaves
    upstream: List[str]    # files this file imports
    downstream: List[str]  # files that import this file


# ── Test generation (code-driven) ──────────────────────────────────────────────

class GenerateFromCodeRequest(BaseModel):
    owner: str
    repo: str
    file_path: str
    file_content: str
    language: str
    impact_context: Optional[List[str]] = None


class GeneratedTest(BaseModel):
    id: str
    name: str
    description: str
    code: str
    framework: str
    file_target: str
    test_type: str   # unit | integration | e2e
    tags: List[str] = []


class GenerateTestsResponse(BaseModel):
    tests: List[GeneratedTest]
    framework: str
    file_path: str


# ── Test generation (doc-driven) ───────────────────────────────────────────────

class DocScenario(BaseModel):
    id: str
    title: str
    description: str
    acceptance_criteria: List[str]
    priority: str = "medium"


class ParseDocsRequest(BaseModel):
    content: str
    filename: str


class ParseDocsResponse(BaseModel):
    scenarios: List[DocScenario]
    total: int


class GenerateFromDocsRequest(BaseModel):
    scenarios: List[DocScenario]
    framework: str = "playwright"


class ImpactPlaywrightStep(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    description: str


class ImpactPlaywrightTest(BaseModel):
    id: str
    analysis_id: str = "doc-impact"
    name: str
    description: str
    page_name: str
    severity: str = "Medium"
    steps: List[ImpactPlaywrightStep] = []
    file_target: str = "generated_from_docs"


class GenerateFromDocsResponse(BaseModel):
    tests: List[ImpactPlaywrightTest]
    total: int


# ── Test execution ─────────────────────────────────────────────────────────────

class RunTestRequest(BaseModel):
    test_id: str
    test_code: str
    framework: str
    language: str


class TestResult(BaseModel):
    test_id: str
    test_name: str
    status: str   # passed | failed | skipped
    duration_ms: int
    error: Optional[str] = None
    output: Optional[str] = None


class RunTestResponse(BaseModel):
    results: List[TestResult]
    passed: int
    failed: int
    total: int
    pass_rate: float
