"""Org-scoped connector settings with env fallback."""
from __future__ import annotations

from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import settings

# Per-request org connectors (raw org overrides). Set by get_current_org.
_current_org_connectors: ContextVar[dict[str, Any] | None] = ContextVar(
    "_current_org_connectors", default=None
)


def set_current_org_connectors(connectors: dict[str, Any] | None) -> Token:
    return _current_org_connectors.set(connectors or {})


def reset_current_org_connectors(token: Token) -> None:
    _current_org_connectors.reset(token)


def active(name: str) -> dict[str, str]:
    """Resolved connector for the current request (org override → env)."""
    return resolve(_current_org_connectors.get(), name)


SECRET_FIELDS = {
    "github": {"token"},
    "jira": {"token"},
    "vercel": {"token"},
    "ollama": {"api_key"},
    "slack": {"webhook_url"},
    "datadog": {"api_key", "app_key"},
}

CONNECTOR_KEYS = ("github", "jira", "vercel", "ollama", "slack", "datadog")


def _mask(value: str | None) -> dict[str, Any]:
    if not value:
        return {"configured": False, "masked": None}
    tail = value[-4:] if len(value) >= 4 else "****"
    return {"configured": True, "masked": f"••••{tail}"}


def _env_defaults() -> dict[str, dict[str, str]]:
    return {
        "github": {
            "token": settings.GITHUB_TOKEN or "",
            "repo_id": getattr(settings, "GITHUB_REPO_ID", "") or "",
        },
        "jira": {
            "domain": settings.JIRA_DOMAIN or "",
            "email": settings.JIRA_EMAIL or "",
            "token": settings.JIRA_TOKEN or "",
        },
        "vercel": {
            "token": settings.VERCEL_TOKEN or "",
            "team_id": settings.VERCEL_TEAM_ID or "",
            "project_id": settings.VERCEL_PROJECT_ID or "",
            "project_name": settings.VERCEL_PROJECT_NAME or "",
        },
        "ollama": {
            "base_url": settings.OLLAMA_BASE_URL or "",
            "api_key": settings.OLLAMA_API_KEY or "",
            "model": settings.OLLAMA_MODEL or "",
        },
        "slack": {"webhook_url": getattr(settings, "SLACK_WEBHOOK_URL", "") or ""},
        "datadog": {
            "api_key": getattr(settings, "DATADOG_API_KEY", "") or "",
            "app_key": getattr(settings, "DATADOG_APP_KEY", "") or "",
        },
    }


async def get_raw(db: AsyncIOMotorDatabase, org_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(org_id):
        return {}
    doc = await db.organizations.find_one({"_id": ObjectId(org_id)}, {"connectors": 1})
    return (doc or {}).get("connectors") or {}


def resolve(org_connectors: dict[str, Any] | None, name: str) -> dict[str, str]:
    """Merge org overrides over env defaults (non-empty org wins)."""
    base = _env_defaults().get(name, {})
    override = (org_connectors or {}).get(name) or {}
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, str) and v.strip() and v.strip() != "***":
            out[k] = v.strip()
    return out


def public_view(org_connectors: dict[str, Any] | None) -> dict[str, Any]:
    """Masked view for UI never return full secrets."""
    raw = org_connectors or {}
    env = _env_defaults()
    out: dict[str, Any] = {}
    for name in CONNECTOR_KEYS:
        merged = resolve(raw, name)
        secrets = SECRET_FIELDS.get(name, set())
        panel: dict[str, Any] = {}
        for k, v in merged.items():
            if k in secrets:
                # Prefer showing org-configured mask if org has value
                org_val = (raw.get(name) or {}).get(k)
                source = "org" if org_val else ("env" if env.get(name, {}).get(k) else "none")
                panel[k] = {**_mask(v if v else None), "source": source}
            else:
                panel[k] = v or ""
        out[name] = panel
    out["updated_at"] = raw.get("updated_at")
    return out


async def update(
    db: AsyncIOMotorDatabase,
    org_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    if not ObjectId.is_valid(org_id):
        raise ValueError("invalid org id")
    existing = await get_raw(db, org_id)
    merged = dict(existing)
    for name in CONNECTOR_KEYS:
        if name not in patch:
            continue
        incoming = patch[name] or {}
        if not isinstance(incoming, dict):
            continue
        current = dict(merged.get(name) or {})
        secrets = SECRET_FIELDS.get(name, set())
        for k, v in incoming.items():
            if not isinstance(k, str):
                continue
            if v is None:
                continue
            if not isinstance(v, str):
                v = str(v)
            # Blank or *** means keep existing secret
            if k in secrets and (not v.strip() or v.strip() in {"***", "••••", "••••••••"}):
                continue
            if not v.strip() and k not in secrets:
                current.pop(k, None)
                continue
            current[k] = v.strip()
        merged[name] = current
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.organizations.update_one(
        {"_id": ObjectId(org_id)},
        {"$set": {"connectors": merged}},
    )
    return public_view(merged)
