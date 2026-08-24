"""
Backend-issued session cookie. WorkOS verifies identity once at login;
after that, this signed JWT (not a WorkOS session) is what every request
is authenticated against, so the backend never has to call out to WorkOS
on the hot path.
"""
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

COOKIE_NAME = "aidlc_session"
_ALGORITHM = "HS256"
_TTL = timedelta(days=7)


def create_session_cookie(user_id: str, org_id: str) -> str:
    payload = {
        "user_id": user_id,
        "org_id": org_id,
        "exp": datetime.now(timezone.utc) + _TTL,
    }
    return jwt.encode(payload, settings.SESSION_SECRET, algorithm=_ALGORITHM)


def decode_session_cookie(token: str) -> dict:
    return jwt.decode(token, settings.SESSION_SECRET, algorithms=[_ALGORITHM])
