"""
Production Monitoring & Anomaly Detection routes.
Uses dataset quality time series + AI predictive alerts.
"""
import math
import random
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Body

from app.services.ai_service import generate_predictive_alert, AIQuotaError
from app.services import datadog_service, slack_service

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def _z_score(value: float, mean: float, std: float) -> float:
    if std == 0:
        return 0.0
    return (value - mean) / std


def _detect_anomalies(series: list[dict], threshold: float = 2.5) -> list[dict]:
    """Rolling Z-score anomaly detection on quality dimensions."""
    dimensions = ["completeness", "uniqueness", "validity", "consistency", "overall"]
    anomalies = []
    for dim in dimensions:
        values = [p.get(dim, 0) for p in series]
        if len(values) < 3:
            continue
        mean = statistics.mean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0
        for i, (point, val) in enumerate(zip(series, values)):
            z = _z_score(val, mean, std)
            if abs(z) > threshold:
                # Also check single-step drop
                prev_val = values[i - 1] if i > 0 else val
                drop = prev_val - val
                anomalies.append({
                    "date": point["date"],
                    "dimension": dim,
                    "value": round(val, 2),
                    "z_score": round(z, 2),
                    "drop": round(drop, 2),
                    "severity": "critical" if abs(z) > 3.5 else "warning",
                })
        # Also flag single-day drops > 10pp
        for i in range(1, len(values)):
            drop = values[i - 1] - values[i]
            if drop > 10:
                existing = [a for a in anomalies if a["date"] == series[i]["date"] and a["dimension"] == dim]
                if not existing:
                    anomalies.append({
                        "date": series[i]["date"],
                        "dimension": dim,
                        "value": round(values[i], 2),
                        "z_score": round(_z_score(values[i], mean, std), 2),
                        "drop": round(drop, 2),
                        "severity": "warning",
                    })
    return sorted(anomalies, key=lambda x: abs(x["z_score"]), reverse=True)


@router.post("/simulate-time-series")
async def simulate_time_series(body: dict = Body(...)):
    """
    Generate a synthetic 30-day quality score time series from a baseline dataset snapshot.
    Injects realistic anomalies at days 22-26 for demo purposes.
    """
    baseline = body.get("baseline", {})
    days = body.get("days", 30)
    seed = body.get("seed", 42)

    rng = random.Random(seed)
    start_completeness = baseline.get("completeness", 88.0)
    start_uniqueness = baseline.get("uniqueness", 94.0)
    start_validity = baseline.get("validity", 91.0)
    start_consistency = baseline.get("consistency", 87.0)

    today = datetime.now(timezone.utc)
    series = []

    for i in range(days):
        day = today - timedelta(days=(days - i - 1))
        date_str = day.strftime("%Y-%m-%d")

        # Random walk with drift
        noise = lambda: rng.gauss(0, 0.8)

        completeness = min(100, max(0, start_completeness + noise() * (i + 1) ** 0.3))
        uniqueness = min(100, max(0, start_uniqueness + noise() * 0.5))
        validity = min(100, max(0, start_validity + noise() * 0.7))
        consistency = min(100, max(0, start_consistency + noise() * 0.6))

        # Inject synthetic anomaly at day 22-26
        if 21 <= i <= 25:
            completeness -= rng.uniform(8, 18)
        if i == 27:
            uniqueness -= rng.uniform(5, 12)

        completeness = round(max(0, completeness), 2)
        uniqueness = round(max(0, uniqueness), 2)
        validity = round(max(0, validity), 2)
        consistency = round(max(0, consistency), 2)
        overall = round((completeness + uniqueness + validity + consistency) / 4, 2)

        series.append({
            "date": date_str,
            "completeness": completeness,
            "uniqueness": uniqueness,
            "validity": validity,
            "consistency": consistency,
            "overall": overall,
        })

    anomalies = _detect_anomalies(series)
    return {"series": series, "anomalies": anomalies}


@router.post("/analyze")
async def analyze_time_series(body: dict = Body(...)):
    """
    Receive a pre-computed quality time series and return anomalies + AI alert.
    """
    series: list[dict] = body.get("series", [])
    if not series:
        raise HTTPException(status_code=400, detail="series is required")

    anomalies = _detect_anomalies(series)

    # Generate AI alert if anomalies found
    predictive_alert = None
    if anomalies:
        try:
            predictive_alert = await generate_predictive_alert(series, anomalies)
            # Optionally send critical anomalies to Slack
            critical = [a for a in anomalies if a["severity"] == "critical"]
            if critical:
                most_critical = critical[0]
                await slack_service.send_critical_anomaly(
                    column=most_critical["dimension"],
                    metric=most_critical["dimension"],
                    drop=most_critical.get("drop", 0),
                    alert_message=predictive_alert.get("alert_message", ""),
                )
        except AIQuotaError as exc:
            raise HTTPException(status_code=429, detail=str(exc))
        except Exception:
            pass

    # Post to Datadog
    if series:
        latest = series[-1]
        try:
            await datadog_service.tag_dataset_analysis(
                dataset_name="quality_monitoring",
                quality_score=latest.get("overall", 0),
                anomalies=len(anomalies),
            )
        except Exception:
            pass

    return {
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "predictive_alert": predictive_alert,
        "latest_scores": series[-1] if series else {},
    }
