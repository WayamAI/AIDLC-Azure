"""Slack Incoming Webhook notifications."""
import httpx
from app.config import settings


async def send_message(text: str, blocks: list | None = None) -> bool:
    """Post a message to the configured Slack webhook. Returns True on success."""
    if not settings.SLACK_WEBHOOK_URL:
        return False
    payload: dict = {"text": text}
    if blocks:
        payload["blocks"] = blocks
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(settings.SLACK_WEBHOOK_URL, json=payload)
            return resp.status_code == 200
    except Exception:
        return False


async def send_release_blocked(version: str, reason: str, score: int) -> bool:
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"🚫 Release Blocked: {version}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Score:* {score}/100"},
                {"type": "mrkdwn", "text": f"*Verdict:* NO-GO"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Reason:* {reason}"},
        },
    ]
    return await send_message(f"Release {version} blocked. Score: {score}/100.", blocks)


async def send_critical_anomaly(column: str, metric: str, drop: float, alert_message: str) -> bool:
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "⚠️ Critical Data Quality Anomaly"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Column:* `{column}`"},
                {"type": "mrkdwn", "text": f"*Metric:* {metric}"},
                {"type": "mrkdwn", "text": f"*Drop:* {drop:.1f}%"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": alert_message},
        },
    ]
    return await send_message(f"Critical anomaly on column `{column}`: {metric} dropped {drop:.1f}%.", blocks)


async def send_incident_created(incident_id: str, title: str, root_cause: str) -> bool:
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"🔴 Incident Created: {incident_id}"},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*{title}*\n{root_cause}"},
        },
    ]
    return await send_message(f"New incident: {title}", blocks)
