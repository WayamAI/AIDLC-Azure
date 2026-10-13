"""
Organization service: local mirror of WorkOS organizations, used for fast
lookups and as the attachment point for app-specific settings (plan, usage)
that WorkOS doesn't know about.
"""
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

from app.models.organization import OrganizationOut


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db.organizations.create_index("workos_org_id", unique=True)


def _to_out(doc: dict) -> OrganizationOut:
    return OrganizationOut(
        id=str(doc["_id"]),
        workos_org_id=doc["workos_org_id"],
        name=doc["name"],
        created_at=doc["created_at"],
        plan=doc.get("plan", "free"),
    )


async def create_organization(db: AsyncIOMotorDatabase, workos_org_id: str, name: str) -> OrganizationOut:
    doc = {
        "workos_org_id": workos_org_id,
        "name": name,
        "created_at": datetime.utcnow(),
        "plan": "free",
    }
    result = await db.organizations.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _to_out(doc)


async def get_by_workos_id(db: AsyncIOMotorDatabase, workos_org_id: str) -> OrganizationOut | None:
    doc = await db.organizations.find_one({"workos_org_id": workos_org_id})
    return _to_out(doc) if doc else None


async def get_by_id(db: AsyncIOMotorDatabase, org_id: str) -> OrganizationOut | None:
    if not ObjectId.is_valid(org_id):
        return None
    doc = await db.organizations.find_one({"_id": ObjectId(org_id)})
    return _to_out(doc) if doc else None
