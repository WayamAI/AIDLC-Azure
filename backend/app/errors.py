"""App-level exception handlers: one mapping from typed service errors to HTTP statuses.

    AIQuotaError                         429  LLM quota / rate limit
    AIResponseError, AIGenerationError,
    openai.APIError                      502  LLM provider failed or answered unusably
    GitHubRateLimitError                 429  with the reset time
    GitHubAPIError                       404 / 400 / 502
    JiraNotConfiguredError               503  integration not configured
    VercelServiceError                   its own status code
    WorkspaceExpiredError                410  clone directory no longer on disk
    httpx.HTTPStatusError / RequestError 502  another upstream integration failed

Routes raise these (or let them propagate) instead of wrapping every exception.
"""
import logging

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from openai import APIError

from app.services.ai_service import AIQuotaError, AIResponseError
from app.services.github_service import GitHubAPIError, GitHubRateLimitError
from app.services.impact_service import AIGenerationError
from app.services.jira_service import JiraNotConfiguredError
from app.services.vercel_service import VercelServiceError
from app.services.workspace_service import WorkspaceExpiredError

logger = logging.getLogger("aidlc")


def _detail(status_code: int, detail: str, headers: dict[str, str] | None = None, **extra) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail, **extra}, headers=headers)


async def _ai_quota(request: Request, exc: AIQuotaError) -> JSONResponse:
    return _detail(429, str(exc))


async def _ai_failure(request: Request, exc: Exception) -> JSONResponse:
    logger.warning("AI provider failure on %s %s: %s", request.method, request.url.path, exc)
    return _detail(502, f"The AI provider call failed: {exc}")


async def _github_rate_limit(request: Request, exc: GitHubRateLimitError) -> JSONResponse:
    headers = {}
    reset_at = exc.reset_at.isoformat() if exc.reset_at else None
    if exc.reset_at:
        headers["X-RateLimit-Reset"] = str(int(exc.reset_at.timestamp()))
    return _detail(429, exc.message, headers=headers, source="github", reset_at=reset_at)


async def _github_error(request: Request, exc: GitHubAPIError) -> JSONResponse:
    # The message already says what to check (see github_service.describe_github_error).
    if exc.status_code == 404:
        return _detail(404, exc.message)
    if exc.status_code == 403:
        return _detail(403, exc.message)
    if exc.status_code == 422:
        return _detail(400, exc.message)
    return _detail(502, exc.message)


async def _jira_not_configured(request: Request, exc: JiraNotConfiguredError) -> JSONResponse:
    return _detail(503, str(exc))


async def _vercel_error(request: Request, exc: VercelServiceError) -> JSONResponse:
    return _detail(exc.status_code, exc.message)


async def _workspace_expired(request: Request, exc: WorkspaceExpiredError) -> JSONResponse:
    return _detail(410, str(exc))


async def _upstream_status(request: Request, exc: httpx.HTTPStatusError) -> JSONResponse:
    host = exc.request.url.host
    logger.warning("upstream %s returned %s on %s", host, exc.response.status_code, request.url.path)
    return _detail(502, f"{host} returned HTTP {exc.response.status_code}")


async def _upstream_unreachable(request: Request, exc: httpx.RequestError) -> JSONResponse:
    try:
        host = exc.request.url.host
    except RuntimeError:
        host = "An upstream service"
    return _detail(502, f"{host} could not be reached: {type(exc).__name__}")


async def _workspace_path(request: Request, exc: Exception) -> JSONResponse:
    return _detail(400, str(exc))


def register_exception_handlers(app: FastAPI) -> None:
    from app.services.ai_ide_service import WorkspacePathError

    app.add_exception_handler(WorkspacePathError, _workspace_path)
    app.add_exception_handler(AIQuotaError, _ai_quota)
    app.add_exception_handler(AIResponseError, _ai_failure)
    app.add_exception_handler(AIGenerationError, _ai_failure)
    app.add_exception_handler(APIError, _ai_failure)
    app.add_exception_handler(GitHubRateLimitError, _github_rate_limit)
    app.add_exception_handler(GitHubAPIError, _github_error)
    app.add_exception_handler(JiraNotConfiguredError, _jira_not_configured)
    app.add_exception_handler(VercelServiceError, _vercel_error)
    app.add_exception_handler(WorkspaceExpiredError, _workspace_expired)
    app.add_exception_handler(httpx.HTTPStatusError, _upstream_status)
    app.add_exception_handler(httpx.RequestError, _upstream_unreachable)
