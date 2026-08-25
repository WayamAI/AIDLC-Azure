import pytest
from app.services import root_cause_service
from app.models.root_cause import RootCauseEvidence


def _sample_test_result():
    return {
        "test_id": "t1",
        "test_name": "Checkout flow",
        "status": "failed",
        "error": None,
        "step_results": [
            {"step_description": "navigate to /checkout", "status": "pass", "error": None},
            {"step_description": "click #pay-btn", "status": "fail", "error": "Timeout 8000ms exceeded waiting for selector \"#pay-btn\""},
        ],
    }


def test_build_evidence_extracts_failed_step_and_marks_no_git_data():
    result = _sample_test_result()
    evidence = root_cause_service.build_evidence_sync(result, repo_doc=None)
    assert isinstance(evidence, RootCauseEvidence)
    assert evidence.failed_step is not None
    assert evidence.failed_step.step_description == "click #pay-btn"
    assert "Timeout" in evidence.error_message
    assert evidence.has_git_data is False
    assert evidence.recent_commits == []
    assert len(evidence.step_trace) == 2


def test_classify_failure_type_selector_not_found():
    ft = root_cause_service.classify_failure_type("Timeout 8000ms exceeded waiting for selector \"#pay-btn\"")
    assert ft == "selector_not_found"


def test_classify_failure_type_playwright_locator_timeout():
    err = (
        "Locator.click: Timeout 8000ms exceeded.\n"
        "Call log:\n"
        "  - waiting for locator(\"#does-not-exist-aidlc\")"
    )
    assert root_cause_service.classify_failure_type(err) == "selector_not_found"


def test_classify_failure_type_network():
    ft = root_cause_service.classify_failure_type("net::ERR_CONNECTION_REFUSED at http://localhost:8080")
    assert ft == "network_error"


def test_classify_failure_type_unknown_for_empty():
    assert root_cause_service.classify_failure_type(None) == "unknown"


def test_build_evidence_no_failed_steps_still_returns_evidence():
    result = {"test_id": "t2", "test_name": "Passing-looking test", "status": "failed", "error": "top-level crash", "step_results": []}
    evidence = root_cause_service.build_evidence_sync(result, repo_doc=None)
    assert evidence.failed_step is None
    assert evidence.error_message == "top-level crash"
    assert evidence.has_stack_trace is False


@pytest.mark.asyncio
async def test_build_evidence_git_lookup_failure_is_non_fatal(monkeypatch):
    def _boom(*a, **kw):
        raise RuntimeError("git clone failed: repo unreachable")
    monkeypatch.setattr(root_cause_service.repo_service, "get_repo_commits", _boom)
    result = {"test_id": "t3", "test_name": "X", "status": "failed", "error": "err", "step_results": []}
    evidence = await root_cause_service.build_evidence(result, repo_doc={"github_url": "https://github.com/x/y"})
    assert evidence.has_git_data is False
    assert evidence.recent_commits == []


@pytest.mark.asyncio
async def test_build_evidence_git_lookup_success_populates_commits_and_diff(monkeypatch):
    """Exercises the success path of git correlation (never covered before this fix wave).

    Would have caught two real bugs: (1) build_evidence blocking the event loop by
    calling repo_service functions directly instead of via asyncio.to_thread, and
    (2) reading evidence.git_diff from the wrong dict key ("diff" instead of the
    real "diff_text" key returned by get_commit_diff_content).
    """
    fake_commits = [
        {"sha": "abc123def456789", "message": "Fix payment button selector\nmore body", "author": "jane", "date": "2026-08-20T10:00:00Z"},
        {"sha": "111222333444555", "message": "Unrelated commit", "author": "joe", "date": "2026-08-19T10:00:00Z"},
    ]

    def _fake_get_repo_commits(github_url, n=5):
        assert n == 5
        return fake_commits

    def _fake_get_commit_diff_content(github_url, sha):
        assert sha == fake_commits[0]["sha"]
        return {
            "commit_info": {},
            "changed_files": ["src/pay.ts"],
            "diff_text": "diff --git a/src/pay.ts b/src/pay.ts\n+++ EXPECTED_DIFF_CONTENT_MARKER\n",
            "file_contents": {},
        }

    monkeypatch.setattr(root_cause_service.repo_service, "get_repo_commits", _fake_get_repo_commits)
    monkeypatch.setattr(root_cause_service.repo_service, "get_commit_diff_content", _fake_get_commit_diff_content)

    result = {"test_id": "t4", "test_name": "Checkout", "status": "failed", "error": "err", "step_results": []}
    evidence = await root_cause_service.build_evidence(result, repo_doc={"github_url": "https://github.com/x/y"})

    assert evidence.has_git_data is True
    assert len(evidence.recent_commits) == 2
    assert evidence.recent_commits[0].sha == "abc123def456"
    assert evidence.recent_commits[0].message == "Fix payment button selector"
    assert evidence.git_diff is not None
    assert len(evidence.git_diff) > 0
    assert "EXPECTED_DIFF_CONTENT_MARKER" in evidence.git_diff
