"""Datadog Events & Metrics API integration."""
import time
from typing import Any

import httpx

from app.config import settings

_DD_API = "https://api.datadoghq.com/api/v1"
_DD_API_V2 = "https://api.datadoghq.com/api/v2"


def _headers() -> dict[str, str]:
    return {
        "DD-API-KEY": settings.DATADOG_API_KEY,
        "DD-APPLICATION-KEY": settings.DATADOG_APP_KEY,
        "Content-Type": "application/json",
    }


async def post_event(title: str, text: str, alert_type: str = "info", tags: list[str] | None = None) -> dict:
    """Post a custom event to Datadog."""
    if not settings.DATADOG_API_KEY:
        return {"status": "skipped", "reason": "DATADOG_API_KEY not configured"}
    payload = {
        "title": title,
        "text": text,
        "alert_type": alert_type,
        "tags": tags or ["source:aidlc"],
        "date_happened": int(time.time()),
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{_DD_API}/events", headers=_headers(), json=payload)
            return resp.json()
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def get_events(start_ts: int | None = None, end_ts: int | None = None, tags: str = "source:aidlc") -> list[dict]:
    """Fetch recent Datadog events."""
    if not settings.DATADOG_API_KEY:
        return []
    now = int(time.time())
    params = {
        "start": start_ts or (now - 86400),
        "end": end_ts or now,
        "tags": tags,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{_DD_API}/events", headers=_headers(), params=params)
            data = resp.json()
            return data.get("events", [])
    except Exception:
        return []


async def tag_dataset_analysis(dataset_name: str, quality_score: float, anomalies: int) -> dict:
    """Post a dataset analysis result as a Datadog event for observability."""
    return await post_event(
        title=f"Dataset Analysis: {dataset_name}",
        text=(
            f"Quality score: {quality_score:.1f}/100\n"
            f"Anomalies detected: {anomalies}\n"
            f"Source: AIDLC"
        ),
        alert_type="info" if quality_score >= 70 else "warning" if quality_score >= 50 else "error",
        tags=["source:aidlc", f"dataset:{dataset_name}", "type:quality-analysis"],
    )
