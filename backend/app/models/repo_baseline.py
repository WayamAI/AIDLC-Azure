"""
Pydantic models for the repo baseline system.
One document per repo. Tracks all test sessions and the full test suite.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


# ── Test category enum ──────────────────────────────────────────────────────
# The AI assigns each test an appropriate category based on what it reads in the
# code not a hardcoded bucket. These enum values are passed verbatim in the
# AI prompt so the model knows exactly what it can choose.

class TestCategory(str, Enum):
    AUTH = "auth"
    API = "api"
    UI_FORM = "ui_form"
    UI_NAVIGATION = "ui_navigation"
    UI_COMPONENT = "ui_component"
    CRUD = "crud"
    INTEGRATION = "integration"
    EDGE_CASE = "edge_case"
    PERFORMANCE = "performance"
    ACCESSIBILITY = "accessibility"


_VALID_CATEGORIES = {c.value for c in TestCategory}


def coerce_category(raw: str | None) -> str:
    """Normalise an AI-returned category. Falls back to ui_component on bad value."""
    v = (raw or "").strip().lower()
    return v if v in _VALID_CATEGORIES else "ui_component"


class BaselineTestStep(BaseModel):
    action: str       # navigate | click | fill | expect | wait | screenshot
    target: str       # CSS selector or URL
    value: Optional[str] = None
    assertion: Optional[str] = None


class BaselineTest(BaseModel):
    """A single Playwright test stored in the repo baseline."""
    test_id: str = Field(default_factory=lambda: f"TC-{uuid.uuid4().hex[:6].upper()}")
    name: str
    description: str
    category: str              # one of TestCategory values
    page_path: Optional[str] = None      # e.g. "/dashboard"
    component_name: Optional[str] = None # e.g. "LoginForm"
    endpoint: Optional[str] = None       # e.g. "POST /api/users"
    severity: str = "medium"             # critical | high | medium | low
    source_file: Optional[str] = None    # relative path of the file this test was derived from
    steps: List[BaselineTestStep] = []
    playwright_code: str = ""            # full runnable Playwright TypeScript code
    added_in_session: str = ""           # session_id that created this test
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_active: bool = True               # soft-delete flag


class ScanSession(BaseModel):
    """Metadata for a single scan run (full or incremental)."""
    session_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    scan_type: str = "full"               # "full" | "incremental"
    changed_files: List[str] = []         # populated for incremental scans
    tests_added: int = 0
    tests_total_after: int = 0
    commit_sha: str = ""
    triggered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "pending"               # pending | running | done | failed
    error: Optional[str] = None
    progress_message: str = ""


class RepoBaseline(BaseModel):
    """
    One MongoDB document per GitHub repo.
    Stores the growing cumulative test suite + history of all scan sessions.
    """
    repo_id: str                     # first 16 chars of SHA-256 of the normalised URL
    github_url: str
    last_commit_sha: str = ""
    tests: List[BaselineTest] = []
    sessions: List[ScanSession] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Request / response models ───────────────────────────────────────────────

class ScanRepoRequest(BaseModel):
    github_url: str
    github_token: Optional[str] = None   # for private repos


class ScanRepoResponse(BaseModel):
    session_id: str
    repo_id: str
    scan_type: str
    status: str


class RepoTestsResponse(BaseModel):
    repo_id: str
    github_url: str
    total_tests: int
    sessions: List[ScanSession]
    tests: List[BaselineTest]
    new_test_ids: List[str] = []         # test_ids added in the requested session


class SyncExternalTestsRequest(BaseModel):
    repo_id: str
    tests: List[BaselineTest]
    source: str = "workspace"             # workspace | live_runner
