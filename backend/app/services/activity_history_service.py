"""Org-scoped activity / search / repo-probe history (Azure-durable)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

Kind = Literal["search", "nav", "repo_probe"]
COLLECTION = "activity_history"
MAX_PER_ORG = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    col = db[COLLECTION]
    await col.create_index([("org_id", 1), ("visited_at", -1)])
    await col.create_index([("org_id", 1), ("kind", 1), ("visited_at", -1)])


async def push(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    user_id: str,
    kind: Kind,
    title: str,
    url: str,
    section: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    col = db[COLLECTION]
    # Dedupe same url+kind for this org: bump visited_at
    existing = await col.find_one({"org_id": org_id, "kind": kind, "url": url})
    doc = {
        "org_id": org_id,
        "user_id": user_id,
        "kind": kind,
        "title": title.strip()[:200],
        "url": url.strip()[:500],
        "section": (section or "")[:120] or None,
        "payload": payload or {},
        "visited_at": _now(),
    }
    if existing:
        await col.update_one({"_id": existing["_id"]}, {"$set": doc})
        doc["id"] = str(existing["_id"])
    else:
        res = await col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        # Cap collection size per org
        cursor = col.find({"org_id": org_id}, {"_id": 1}).sort("visited_at", -1).skip(MAX_PER_ORG)
        stale = [d["_id"] async for d in cursor]
        if stale:
            await col.delete_many({"_id": {"$in": stale}})
    doc.pop("_id", None)
    visited = doc.get("visited_at")
    if hasattr(visited, "isoformat"):
        doc["visited_at"] = visited.isoformat()
    return doc


async def list_history(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    kind: Kind | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"org_id": org_id}
    if kind:
        q["kind"] = kind
    limit = max(1, min(limit, 100))
    cursor = db[COLLECTION].find(q).sort("visited_at", -1).limit(limit)
    out: list[dict[str, Any]] = []
    async for d in cursor:
        out.append(
            {
                "id": str(d["_id"]),
                "kind": d.get("kind", "nav"),
                "title": d.get("title", ""),
                "url": d.get("url", ""),
                "section": d.get("section"),
                "payload": d.get("payload") or {},
                "visited_at": d.get("visited_at").isoformat() if d.get("visited_at") else None,
                "user_id": d.get("user_id"),
            }
        )
    return out


async def clear(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    kind: Kind | None = None,
) -> int:
    q: dict[str, Any] = {"org_id": org_id}
    if kind:
        q["kind"] = kind
    res = await db[COLLECTION].delete_many(q)
    return int(res.deleted_count)
