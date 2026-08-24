"""
Local user accounts (email + password) stored in MongoDB `users`.
Used when WorkOS is not configured signup/login against real persisted data.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger("user_service")

COLLECTION = "users"
_SEED_EMAIL = "mriganka.dey@wayam.ai"
_SEED_PASSWORD = "wayam"
_SEED_ORG_WORKOS_ID = "wayam_local_org"


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120_000,
    ).hex()
    return digest, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    digest, _ = _hash_password(password, salt)
    return hmac.compare_digest(digest, password_hash)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    try:
        await db[COLLECTION].create_index("email", unique=True)
        await db[COLLECTION].create_index("org_id")
    except Exception as exc:
        log.warning("user index creation failed (non-fatal): %s", exc)


async def get_by_email(db: AsyncIOMotorDatabase, email: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"email": email.strip().lower()})


async def get_by_id(db: AsyncIOMotorDatabase, user_id: str) -> Optional[dict]:
    if not ObjectId.is_valid(user_id):
        return None
    return await db[COLLECTION].find_one({"_id": ObjectId(user_id)})


async def create_user(
    db: AsyncIOMotorDatabase,
    *,
    email: str,
    password: str,
    org_id: str,
    name: str | None = None,
) -> dict:
    email_norm = email.strip().lower()
    existing = await get_by_email(db, email_norm)
    if existing:
        raise ValueError("An account with this email already exists")

    password_hash, salt = _hash_password(password)
    doc = {
        "email": email_norm,
        "name": (name or email_norm.split("@")[0]).strip(),
        "password_hash": password_hash,
        "salt": salt,
        "org_id": org_id,
        "created_at": datetime.utcnow(),
    }
    result = await db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def authenticate(db: AsyncIOMotorDatabase, email: str, password: str) -> Optional[dict]:
    doc = await get_by_email(db, email)
    if not doc:
        return None
    if not verify_password(password, doc["password_hash"], doc["salt"]):
        return None
    return doc


async def seed_wayam_account(db: AsyncIOMotorDatabase) -> None:
    """Ensure mriganka.dey@wayam.ai exists with password wayam (idempotent)."""
    from app.services import organization_service

    existing = await get_by_email(db, _SEED_EMAIL)
    if existing:
        return

    org = await organization_service.get_by_workos_id(db, _SEED_ORG_WORKOS_ID)
    if org is None:
        org = await organization_service.create_organization(
            db, workos_org_id=_SEED_ORG_WORKOS_ID, name="Wayam"
        )

    await create_user(
        db,
        email=_SEED_EMAIL,
        password=_SEED_PASSWORD,
        org_id=org.id,
        name="Mriganka Dey",
    )
    log.info("Seeded local account %s", _SEED_EMAIL)
