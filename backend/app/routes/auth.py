import time
"""
Auth routes: WorkOS SSO (when configured) + local email/password signup & login
persisted in MongoDB. Dev-login remains as a no-password fallback for local demos.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.auth.workos_client import get_authorization_url, authenticate_with_code
from app.auth.session import create_session_cookie, COOKIE_NAME
from app.auth.dependencies import get_current_user_id, get_current_org
from app.config import settings
from app.database import get_db
from app.services import organization_service, user_service

router = APIRouter(prefix="/auth", tags=["Auth"])


class DevLoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class PasswordAuthBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=4, max_length=128)
    name: str | None = Field(default=None, max_length=120)


class SignupBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=128)
    name: str | None = Field(default=None, max_length=120)


def _signup_allowed(email: str) -> bool:
    if settings.APP_ENV != "production" or settings.ALLOW_OPEN_SIGNUP:
        return True
    domain = email.rsplit("@", 1)[-1]
    return domain in {d.lower().lstrip("@") for d in settings.SIGNUP_ALLOWED_DOMAINS}


class ProfileUpdateBody(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    notifications: bool | None = None
    newsletter: bool | None = None


def _workos_configured() -> bool:
    return bool(settings.WORKOS_API_KEY.strip() and settings.WORKOS_CLIENT_ID.strip())


def _set_session(response: Response, user_id: str, org_id: str) -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.APP_ENV == "production",
        max_age=7 * 24 * 3600,
    )


def _ollama_configured() -> bool:
    """True when a real (non-placeholder) Ollama API key is present (env or org connector)."""
    from app.services import connector_settings_service as connectors

    key = (connectors.active("ollama").get("api_key") or settings.OLLAMA_API_KEY or "").strip()
    if not key:
        return False
    placeholders = {
        "ollama",
        "your-ollama-cloud-key",
        "changeme",
        "change-me",
        "sk-xxx",
        "api-key",
    }
    return key.lower() not in placeholders


@router.get("/status")
async def auth_status():
    """Tell the SPA which auth modes are available + AI key readiness."""
    return {
        "workos": _workos_configured(),
        "dev_login": not _workos_configured() and settings.APP_ENV != "production",
        "password_auth": True,
        "signup_enabled": settings.SIGNUP_ENABLED,
        "frontend_url": settings.FRONTEND_URL,
        "ollama_configured": _ollama_configured(),
        "ollama_base_url": settings.OLLAMA_BASE_URL,
        "ollama_model": settings.OLLAMA_MODEL,
    }


@router.get("/login")
async def login():
    if not _workos_configured():
        raise HTTPException(
            status_code=503,
            detail="WorkOS is not configured. Use POST /api/auth/login or /api/auth/signup.",
        )
    return RedirectResponse(url=get_authorization_url(), status_code=302)


@router.get("/callback")
async def callback(code: str, db=Depends(get_db)):
    identity = authenticate_with_code(code)

    if identity.organization_id is None:
        raise HTTPException(status_code=400, detail="No organization associated with this login")

    org = await organization_service.get_by_workos_id(db, identity.organization_id)
    if org is None:
        org = await organization_service.create_organization(
            db, workos_org_id=identity.organization_id, name=identity.email
        )

    response = RedirectResponse(
        url=f"{settings.FRONTEND_URL.rstrip('/')}/dashboard", status_code=302
    )
    _set_session(response, user_id=identity.user_id, org_id=org.id)
    return response


@router.post("/signup")
async def signup(body: SignupBody, db=Depends(get_db)):
    """Create a local user + org and set the session cookie."""
    if not settings.SIGNUP_ENABLED:
        raise HTTPException(status_code=403, detail="Sign-up is disabled. Ask your administrator for an account.")
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if not _signup_allowed(email):
        raise HTTPException(status_code=403, detail="Sign-up is by invitation. Ask your administrator for access.")
    if await user_service.get_by_email(db, email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    # Reuse the org left behind by a signup that failed after creating it.
    org = await organization_service.get_by_workos_id(db, f"local_{email}")
    if org is None:
        org = await organization_service.create_organization(
            db,
            workos_org_id=f"local_{email}",
            name=(body.name or email.split("@")[0]).strip() or "My Org",
        )
    try:
        user = await user_service.create_user(
            db,
            email=email,
            password=body.password,
            org_id=org.id,
            name=body.name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    resp = Response(content='{"status":"ok"}', media_type="application/json")
    _set_session(resp, user_id=str(user["_id"]), org_id=org.id)
    return resp


# Failed sign-ins per client address: 10 within 5 minutes, then a short lock-out.
# Kept in process memory, which is enough for the single instance this app runs as.
_LOGIN_WINDOW_SECONDS = 300
_LOGIN_MAX_FAILURES = 10
_login_failures: dict[str, list[float]] = {}


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def _recent_failures(key: str) -> list[float]:
    cutoff = time.monotonic() - _LOGIN_WINDOW_SECONDS
    recent = [t for t in _login_failures.get(key, []) if t > cutoff]
    if recent:
        _login_failures[key] = recent
    else:
        _login_failures.pop(key, None)
    return recent


@router.post("/login")
async def password_login(body: PasswordAuthBody, request: Request, db=Depends(get_db)):
    """Authenticate a local email/password user and set the session cookie."""
    key = _client_key(request)
    if len(_recent_failures(key)) >= _LOGIN_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Wait a few minutes and try again.")
    user = await user_service.authenticate(db, body.email, body.password)
    if user is None:
        _login_failures.setdefault(key, []).append(time.monotonic())
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _login_failures.pop(key, None)

    resp = Response(content='{"status":"ok"}', media_type="application/json")
    _set_session(resp, user_id=str(user["_id"]), org_id=user["org_id"])
    return resp


@router.post("/dev-login")
async def dev_login(body: DevLoginBody, db=Depends(get_db)):
    """Local-only session mint when WorkOS keys are absent (no password check)."""
    if _workos_configured():
        raise HTTPException(status_code=400, detail="Dev login disabled while WorkOS is configured")
    if settings.APP_ENV == "production":
        raise HTTPException(status_code=403, detail="Dev login is not available in production")

    email = body.email.strip().lower()
    workos_org_id = "dev_org_local"
    org = await organization_service.get_by_workos_id(db, workos_org_id)
    if org is None:
        org = await organization_service.create_organization(
            db, workos_org_id=workos_org_id, name="Local Dev Org"
        )

    resp = Response(content='{"status":"ok"}', media_type="application/json")
    _set_session(resp, user_id=f"dev:{email}", org_id=org.id)
    return resp


@router.post("/logout")
async def logout():
    resp = Response(content='{"status":"logged_out"}', media_type="application/json")
    resp.delete_cookie(COOKIE_NAME)
    return resp


async def _me_payload(db, user_id: str, org) -> dict:
    email = None
    name = None
    notifications = True
    newsletter = False
    if not user_id.startswith("dev:"):
        doc = await user_service.get_by_id(db, user_id)
        if doc:
            email = doc.get("email")
            name = doc.get("name")
            if "notifications" in doc:
                notifications = bool(doc["notifications"])
            if "newsletter" in doc:
                newsletter = bool(doc["newsletter"])
    else:
        email = user_id.removeprefix("dev:")
        name = email.split("@")[0]

    overlay = await user_service.get_profile_overlay(db, user_id)
    if overlay.get("name"):
        name = overlay["name"]
    if "notifications" in overlay:
        notifications = bool(overlay["notifications"])
    if "newsletter" in overlay:
        newsletter = bool(overlay["newsletter"])

    return {
        "user_id": user_id,
        "org_id": org.id,
        "org_name": org.name,
        "email": email,
        "name": name,
        "notifications": notifications,
        "newsletter": newsletter,
    }


@router.get("/me")
async def me(user_id: str = Depends(get_current_user_id), org=Depends(get_current_org), db=Depends(get_db)):
    return await _me_payload(db, user_id, org)


@router.patch("/me")
async def update_me(
    body: ProfileUpdateBody,
    user_id: str = Depends(get_current_user_id),
    org=Depends(get_current_org),
    db=Depends(get_db),
):
    if body.name is None and body.notifications is None and body.newsletter is None:
        raise HTTPException(status_code=400, detail="No updatable fields provided")
    try:
        await user_service.update_profile(
            db,
            user_id=user_id,
            org_id=org.id,
            name=body.name,
            notifications=body.notifications,
            newsletter=body.newsletter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _me_payload(db, user_id, org)
