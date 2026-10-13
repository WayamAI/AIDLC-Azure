"""Repo-analysis jobs: an AI failure fails the job, and job state survives a restart."""
import asyncio
from datetime import timedelta

import pytest

from app.auth.session import create_session_cookie
from app.services import analysis_runner, durable_state, organization_service

ANALYSIS = {
    "summary": "A todo app",
    "tech_stack": "React",
    "pages": [{"name": "Todos", "path": "/"}],
    "user_flows": [],
}
TEST = {
    "name": "Add a todo",
    "description": "d",
    "page_name": "Todos",
    "severity": "High",
    "steps": [{"action": "navigate", "selector": None, "value": "/", "description": "open"}],
}


@pytest.fixture(autouse=True)
def _no_git(monkeypatch):
    """The pipeline's clone/extract steps, without git."""
    monkeypatch.setattr(analysis_runner.repo_service, "clone_repo", lambda url: "/tmp/fake-clone")
    monkeypatch.setattr(analysis_runner.repo_service, "extract_codebase", lambda path: "export default App")
    monkeypatch.setattr(analysis_runner.repo_service, "cleanup_repo", lambda path: None)
    monkeypatch.setattr(durable_state, "FLUSH_SECONDS", 0.01)
    yield
    analysis_runner._jobs.clear()
    analysis_runner._secrets.clear()


def _ai(monkeypatch, analyze=None, generate=None):
    async def _analysis(*_a, **_k):
        return ANALYSIS

    async def _tests(*_a, **_k):
        return [dict(TEST)]

    monkeypatch.setattr(analysis_runner, "analyze_codebase", analyze or _analysis)
    monkeypatch.setattr(analysis_runner, "generate_playwright_tests", generate or _tests)


async def _run(db, **job_kwargs) -> dict:
    job_id = await analysis_runner.create_job(db, "org-1", "https://github.com/x/y", "https://example.com", **job_kwargs)
    await analysis_runner.run_analysis(db, job_id)
    return await analysis_runner.get_job(db, job_id, "org-1")


async def test_successful_job_stores_the_ai_tests(db, monkeypatch):
    _ai(monkeypatch)
    job = await _run(db)

    assert job["status"] == "completed"
    assert job["result"]["tests_source"] == "ai"
    assert [t["name"] for t in job["result"]["tests"]] == ["Add a todo"]
    assert await db.playwright_tests.count_documents({"org_id": "org-1"}) == 1


async def test_generation_timeout_fails_the_job_without_template_tests(db, monkeypatch):
    async def hang(*_a, **_k):
        await asyncio.sleep(30)

    _ai(monkeypatch, generate=hang)
    monkeypatch.setattr(analysis_runner, "_GENERATE_TIMEOUT_S", 0.05)
    job = await _run(db)

    assert job["status"] == "failed"
    assert job["step"] == "failed"
    assert "AI test generation timed out" in job["error"]
    assert job["result"] is None
    assert await db.playwright_tests.count_documents({}) == 0
    assert await db.repo_analyses.count_documents({}) == 0


async def test_generation_error_fails_the_job_with_the_real_reason(db, monkeypatch):
    async def boom(*_a, **_k):
        raise ValueError("bad json from model")

    _ai(monkeypatch, generate=boom)
    job = await _run(db)

    assert job["status"] == "failed"
    assert "bad json from model" in job["error"]
    assert await db.playwright_tests.count_documents({}) == 0


async def test_no_tests_from_the_model_is_a_failure(db, monkeypatch):
    async def nothing(*_a, **_k):
        return []

    _ai(monkeypatch, generate=nothing)
    job = await _run(db)

    assert job["status"] == "failed"
    assert "no test with executable steps" in job["error"]


async def test_analysis_error_fails_the_job_without_a_template_analysis(db, monkeypatch):
    async def boom(*_a, **_k):
        raise analysis_runner.AIQuotaError("rate limited")

    _ai(monkeypatch, analyze=boom)
    job = await _run(db)

    assert job["status"] == "failed"
    assert "quota" in job["error"].lower()
    assert await db.repo_analyses.count_documents({}) == 0


async def test_finished_job_is_read_from_mongo_not_memory(db, monkeypatch):
    _ai(monkeypatch)
    job_id = await analysis_runner.create_job(db, "org-1", "https://github.com/x/y", "https://example.com")
    await analysis_runner.run_analysis(db, job_id)

    assert job_id not in analysis_runner._jobs  # nothing left that a restart could lose
    stored = await db[analysis_runner.JOBS].find_one({"_id": job_id})
    assert stored["status"] == "completed"
    assert any("Analysis complete" in line for line in stored["logs"])
    assert (await analysis_runner.get_job(db, job_id, "other-org")) is None


async def test_test_password_is_never_stored_or_returned(db, monkeypatch):
    seen: dict = {}

    async def _tests(*_a, **kwargs):
        seen.update(kwargs)
        return [dict(TEST)]

    _ai(monkeypatch, generate=_tests)
    job = await _run(db, test_email="qa@example.com", test_password="s3cret-pw")

    assert seen["test_password"] == "s3cret-pw"  # still reaches the generator
    assert "test_password" not in job
    assert "s3cret-pw" not in str(await db[analysis_runner.JOBS].find_one({"_id": job["job_id"]}))


async def test_job_running_when_the_server_died_is_reported_interrupted(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_j", name="J")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    stale = durable_state.now() - timedelta(seconds=durable_state.STALE_AFTER_SECONDS + 5)
    await db[analysis_runner.JOBS].insert_one({
        "_id": "job-dead", "job_id": "job-dead", "org_id": org.id, "status": "running", "step": "analyzing",
        "logs": ["Step 3/4: AI is reading and analysing the codebase..."], "result": None, "error": None,
        "started_at": "2026-01-01T00:00:00+00:00", "completed_at": None, "heartbeat_at": stale,
    })

    resp = await app_client.get("/api/repo/jobs/job-dead")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "failed"
    assert "restart" in body["error"]
    assert body["logs"] == ["Step 3/4: AI is reading and analysing the codebase..."]
    assert "heartbeat_at" not in body and "_id" not in body
    assert (await db[analysis_runner.JOBS].find_one({"_id": "job-dead"}))["status"] == "failed"


async def test_job_with_a_fresh_heartbeat_on_another_worker_stays_running(db):
    await db[analysis_runner.JOBS].insert_one({
        "_id": "job-live", "job_id": "job-live", "org_id": "org-1", "status": "running", "step": "cloning",
        "logs": [], "heartbeat_at": durable_state.now(),
    })
    job = await analysis_runner.get_job(db, "job-live", "org-1")
    assert job["status"] == "running"
