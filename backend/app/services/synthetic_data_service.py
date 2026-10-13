"""
Synthetic data service: generates requirement-driven test data via Gemini and persists it.
"""
from datetime import datetime
from bson import ObjectId

from app.models.synthetic_data import SchemaField, SyntheticDatasetOut
from app.services import ai_service


async def generate_and_store(db, org_id: str, requirement_id: str, count: int) -> SyntheticDatasetOut:
    # ── 1. Fetch the requirement text ──────────────────────────────────────
    req_doc = await db.requirements.find_one({"_id": ObjectId(requirement_id), "org_id": org_id})
    if not req_doc:
        raise ValueError(f"Requirement '{requirement_id}' not found")
    requirement_text: str = req_doc["text"]

    # ── 2. Ask Gemini to design a schema + generate rows ───────────────────
    result = await ai_service.generate_requirement_based_data(requirement_text, count)

    raw_schema: list[dict] = result.get("schema", [])
    rows: list[dict] = result.get("rows", [])

    schema_fields = [SchemaField(**f) for f in raw_schema]

    # ── 3. Persist as a dataset document ──────────────────────────────────
    doc = {
        "org_id": org_id,
        "requirement_id": requirement_id,
        "requirement_text": requirement_text,
        "count": len(rows),
        "schema_fields": [f.model_dump() for f in schema_fields],
        "rows": rows,
        "generated_at": datetime.utcnow(),
    }
    inserted = await db.synthetic_datasets.insert_one(doc)

    return SyntheticDatasetOut(
        id=str(inserted.inserted_id),
        requirement_id=requirement_id,
        requirement_text=requirement_text,
        count=len(rows),
        schema_fields=schema_fields,
        rows=rows,
        generated_at=doc["generated_at"],
    )


async def get_datasets(db, org_id: str, limit: int = 10) -> list[SyntheticDatasetOut]:
    cursor = db.synthetic_datasets.find({"org_id": org_id}).sort("generated_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [
        SyntheticDatasetOut(
            id=str(d["_id"]),
            requirement_id=d["requirement_id"],
            requirement_text=d["requirement_text"],
            count=d["count"],
            schema_fields=[SchemaField(**f) for f in d["schema_fields"]],
            rows=d["rows"],
            generated_at=d["generated_at"],
        )
        for d in docs
    ]
