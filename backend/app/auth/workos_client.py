"""
The only file in this codebase that imports the WorkOS SDK directly.
Every other module goes through the three functions below.

Note on SDK introspection (workos==5.20.0, verified via `pip show workos` and
`python -c "import workos; help(...)"` before writing this):
- `workos.client` is a *module* (containing the `SyncClient` class), not a
  pre-configured singleton instance you can set `.api_key` on. The real way
  to get a configured client is to instantiate `workos.WorkOSClient(api_key=...,
  client_id=...)`.
- `WorkOSClient.__init__` raises `ValueError` immediately if `api_key`/
  `client_id` are falsy and not present in the environment. Local dev/test
  runs leave `WORKOS_API_KEY`/`WORKOS_CLIENT_ID` empty in `.env`, so we fall
  back to harmless placeholder values to keep import-time construction safe;
  `get_authorization_url` builds its URL purely locally (no HTTP call), so a
  placeholder key doesn't affect that function's correctness, and any call
  that *would* need real credentials (`authenticate_with_code`,
  `verify_webhook`) is exercised through mocked tests here and will simply
  fail loudly against the live WorkOS API if real credentials are missing.
- `webhooks.verify_event` takes `event_body=` / `event_signature=` keyword
  args (not `payload=` / `sig_header=` as the original plan draft assumed),
  and returns a deserialized Pydantic `Webhook` model, not a plain dict. We
  normalize that to a dict via `model_dump()` to honor this wrapper's
  `-> dict` contract, while still returning a plain dict untouched (mocks in
  tests hand back plain dicts).
- `webhooks.verify_event` already raises `ValueError` internally on a bad
  signature; we still wrap broadly to guarantee `ValueError` is what callers
  see regardless of the underlying SDK's exception type.
"""
from dataclasses import dataclass

import workos

from app.config import settings

_client = workos.WorkOSClient(
    api_key=settings.WORKOS_API_KEY or "sk_test_placeholder",
    client_id=settings.WORKOS_CLIENT_ID or "client_test_placeholder",
)


@dataclass(frozen=True)
class WorkOSIdentity:
    user_id: str
    email: str
    organization_id: str | None


def get_authorization_url() -> str:
    """URL the frontend redirects the browser to for hosted login/signup."""
    return _client.user_management.get_authorization_url(
        provider="authkit",
        redirect_uri=settings.WORKOS_REDIRECT_URI,
    )


def authenticate_with_code(code: str) -> WorkOSIdentity:
    """Exchange the one-time code from the AuthKit redirect for identity."""
    response = _client.user_management.authenticate_with_code(code=code)
    return WorkOSIdentity(
        user_id=response.user.id,
        email=response.user.email,
        organization_id=getattr(response, "organization_id", None),
    )


def verify_webhook(payload: bytes, signature: str) -> dict:
    """Verify a WorkOS webhook's signature. Raises ValueError if invalid."""
    try:
        event = _client.webhooks.verify_event(
            event_body=payload,
            event_signature=signature,
            secret=settings.WORKOS_WEBHOOK_SECRET,
        )
    except Exception as exc:
        raise ValueError(f"Invalid WorkOS webhook signature: {exc}") from exc

    if hasattr(event, "model_dump"):
        return event.model_dump()
    return event
