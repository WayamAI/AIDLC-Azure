"""PR review: per-file failures are reported, never hidden behind an approving verdict."""
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.config import settings
from app.routes import github as github_routes
from app.services import ai_service, organization_service
from app.services.ai_service import AIQuotaError

PATCH = "@@ -1,2 +1,3 @@\n context\n+added line\n context\n"


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


def _file(name: str, patch_text: str = PATCH) -> dict:
    return {"filename": name, "status": "modified", "additions": 1, "deletions": 0, "patch": patch_text}


def _fake_llm(fail_for: set[str] = frozenset(), error: Exception | None = None):
    """Stand-in for ai_service._call_openai: fails any per-file call naming a file in fail_for."""
    async def call(prompt: str, **_kwargs) -> str:
        if "FILE SUMMARIES:" in prompt:
            return json.dumps({
                "overall_risk": "low",
                "what_changed": "Small change.",
                "test_coverage_estimate": "None",
                "review_recommendation": "APPROVE",
            })
        if "## Changes made to" in prompt:
            if any(f"## Changes made to `{name}`" in prompt for name in fail_for):
                raise error or RuntimeError("upstream 500")
            return json.dumps({"findings": [], "security_flags": [], "positive_observations": []})
        # Summary/triage prompts carry only the diff, so they always succeed here
        # and send every file on to the per-file review.
        return json.dumps({"summary": "Changed a line.", "triage": "NEEDS_REVIEW"})
    return call


async def test_clean_review_reports_every_file_reviewed():
    files = [_file("a.py"), _file("b.py")]
    with patch.object(ai_service, "_call_openai", new=_fake_llm()):
        result = await ai_service.review_pull_request("t", "", files)

    meta = result["meta"]
    assert result["recommendation"] == "APPROVE"
    assert meta["review_status"] == "complete"
    assert (meta["files_in_pr"], meta["files_reviewed"], meta["files_failed"]) == (2, 2, 0)


async def test_failed_file_makes_review_incomplete_never_approved():
    files = [_file("a.py"), _file("b.py"), _file("c.py")]
    with patch.object(ai_service, "_call_openai", new=_fake_llm(fail_for={"b.py"})):
        result = await ai_service.review_pull_request("t", "", files)

    meta = result["meta"]
    assert result["recommendation"] == "INCOMPLETE"
    assert result["summary"]["review_recommendation"] == "INCOMPLETE"
    assert meta["review_status"] == "incomplete"
    assert meta["files_reviewed"] == 2
    assert meta["files_failed"] == 1
    assert meta["failed_files"][0]["file"] == "b.py"
    assert "upstream 500" in meta["failed_files"][0]["error"]


async def test_skipped_and_truncated_files_are_counted(monkeypatch):
    monkeypatch.setattr(settings, "PR_REVIEW_MAX_FILES", 2)
    monkeypatch.setattr(settings, "PR_REVIEW_MAX_PATCH_CHARS", 500)
    long_patch = PATCH + "+" + "x" * 600 + "\n"
    files = [_file("a.py", long_patch), _file("binary.png", ""), _file("b.py"), _file("c.py")]
    with patch.object(ai_service, "_call_openai", new=_fake_llm()):
        result = await ai_service.review_pull_request("t", "", files)

    meta = result["meta"]
    assert meta["files_in_pr"] == 4
    assert meta["files_reviewed"] == 2
    assert meta["files_truncated"] == 1
    assert meta["truncated_files"] == ["a.py"]
    assert {s["file"] for s in meta["skipped_files"]} == {"binary.png", "c.py"}
    assert meta["review_status"] == "partial"


async def test_every_file_rate_limited_raises_quota_error_instead_of_falling_back():
    files = [_file("a.py"), _file("b.py")]
    llm = _fake_llm(fail_for={"a.py", "b.py"}, error=AIQuotaError("AI backend quota exceeded"))
    with patch.object(ai_service, "_call_openai", new=llm):
        with pytest.raises(AIQuotaError):
            await ai_service.review_pull_request("t", "", files)


@pytest.mark.anyio
async def test_endpoint_returns_429_when_every_file_hits_quota(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_pr1", name="PR1")
    _cookies(app_client, org.id)
    files = [_file("a.py"), _file("b.py")]
    llm = _fake_llm(fail_for={"a.py", "b.py"}, error=AIQuotaError("AI backend quota exceeded"))
    with patch.object(github_routes.github_service, "get_pr_detail", new=AsyncMock(return_value={"title": "t", "body": "", "changed_files": 2})), \
         patch.object(github_routes.github_service, "get_pr_files", new=AsyncMock(return_value=files)), \
         patch.object(ai_service, "_call_openai", new=llm):
        resp = await app_client.post("/api/github/pr/7/review", params={"owner": "o", "repo": "r"})

    assert resp.status_code == 429


@pytest.mark.anyio
async def test_endpoint_returns_real_counts_and_incomplete_status(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_pr2", name="PR2")
    _cookies(app_client, org.id)
    files = [_file("a.py"), _file("b.py"), _file("image.png", "")]
    # GitHub reports 5 changed files but only 3 were fetched.
    detail = {"title": "t", "body": "", "changed_files": 5, "user": {"login": "dev"}}
    with patch.object(github_routes.github_service, "get_pr_detail", new=AsyncMock(return_value=detail)), \
         patch.object(github_routes.github_service, "get_pr_files", new=AsyncMock(return_value=files)), \
         patch.object(ai_service, "_call_openai", new=_fake_llm(fail_for={"b.py"})):
        resp = await app_client.post("/api/github/pr/7/review", params={"owner": "o", "repo": "r"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["files_in_pr"] == 5
    assert body["files_reviewed"] == 1
    assert body["files_failed"] == 1
    assert body["files_skipped"] == 3
    assert body["review_status"] == "incomplete"
    assert body["review"]["recommendation"] == "INCOMPLETE"
