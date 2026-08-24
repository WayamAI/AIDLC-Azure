"""
Self-Healing Tests routes.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.healing import (
    HealingAttempt,
    HealingAttemptOut,
    HealingCandidate,
    HealingSummaryOut,
    ValidationResult,
    healing_confidence_label,
)
from app.services import ai_service, healing_service, root_cause_service

router = APIRouter(prefix="/testing/healing", tags=["Self-Healing Tests"])

_SELECTOR_RE = re.compile(
    r"""(?:selector\s+[\"']([^\"']+)[\"']|locator\([\"']([^\"']+)[\"']\)|([#.\[][^\s\"']+))""",
    re.I,
)


def _extract_selector(error: str | None, step_description: str | None) -> str | None:
    for text in (error, step_description):
        if not text:
            continue
        m = _SELECTOR_RE.search(text)
        if m:
            return next(g for g in m.groups() if g)
    return None


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _to_out(doc: dict) -> dict:
    conf = float(doc.get("confidence") or 0)
    return {
        "id": doc["_id"],
        "run_id": doc["run_id"],
        "test_id": doc["test_id"],
        "step_number": doc["step_number"],
        "test_name": doc["test_name"],
        "failure_type": doc["failure_type"],
        "original_selector": doc.get("original_selector"),
        "step_description": doc.get("step_description"),
        "target_url": doc["target_url"],
        "candidate": doc.get("candidate") or HealingCandidate().model_dump(),
        "validation": doc.get("validation") or ValidationResult().model_dump(),
        "confidence": conf,
        "confidence_label": healing_confidence_label(conf),
        "status": doc.get("status", "pending"),
        "error": doc.get("error"),
        "created_at": _iso(doc.get("created_at")),
        "decided_at": _iso(doc.get("decided_at")),
    }


def _list_item(doc: dict) -> dict:
    conf = float(doc.get("confidence") or 0)
    candidate = doc.get("candidate") or {}
    return {
        "id": doc["_id"],
        "test_name": doc.get("test_name", ""),
        "failure_type": doc.get("failure_type", "unknown"),
        "original_selector": doc.get("original_selector"),
        "candidate_selector": candidate.get("selector"),
        "confidence": conf,
        "confidence_label": healing_confidence_label(conf),
        "status": doc.get("status", "pending"),
        "created_at": _iso(doc.get("created_at")),
    }


@router.post("/analyze", response_model=HealingAttemptOut)
async def analyze_healing(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    run_id = (body.get("run_id") or "").strip()
    test_id = (body.get("test_id") or "").strip()
    target_url = (body.get("target_url") or "").strip()
    if not run_id or not test_id or not target_url:
        raise HTTPException(status_code=400, detail="run_id, test_id, and target_url are required")

    run_doc, test_result = await root_cause_service.collect_evidence(db, org.id, run_id, test_id)
    if not run_doc or not test_result:
        raise HTTPException(status_code=404, detail="Run or test not found for this organization")
    if test_result.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Only failed tests can be healed")

    evidence = root_cause_service.build_evidence_sync(test_result, None)
    failed_step = evidence.failed_step
    error_message = evidence.error_message
    failure_type = root_cause_service.classify_failure_type(error_message)

    step_number = failed_step.step_number if failed_step else 1
    step_description = failed_step.step_description if failed_step else None
    original_selector = _extract_selector(error_message, step_description)

    attempt_id = str(uuid.uuid4())
    now = datetime.utcnow()
    base = {
        "_id": attempt_id,
        "org_id": org.id,
        "run_id": run_id,
        "test_id": test_id,
        "step_number": step_number,
        "test_name": test_result.get("test_name", "Unnamed test"),
        "failure_type": failure_type,
        "original_selector": original_selector,
        "step_description": step_description,
        "target_url": target_url,
        "candidate": HealingCandidate().model_dump(),
        "validation": ValidationResult().model_dump(),
        "confidence": 0.0,
        "status": "failed",
        "error": None,
        "created_at": now,
        "decided_at": None,
    }

    if failure_type != "selector_not_found":
        base["error"] = (
            f"Healing is not yet automated for failure type '{failure_type}'. "
            "Only selector_not_found failures can be healed today."
        )
        await healing_service.save_attempt(db, HealingAttempt.model_validate(base))
        return _to_out(base)

    path = "/"
    candidates = await healing_service.scan_page_elements(target_url, path)
    if not candidates:
        base["error"] = (
            "No interactive elements were found on the live page "
            "(unreachable URL, empty DOM, or scan failure)."
        )
        await healing_service.save_attempt(db, HealingAttempt.model_validate(base))
        return _to_out(base)

    ai_result = await ai_service.suggest_selector_repair(
        original_selector or "",
        step_description or "",
        [c.model_dump() for c in candidates],
    )
    idx = ai_result.get("selected_index")
    if idx is None:
        base["candidate"] = HealingCandidate(
            source="none",
            reasoning=ai_result.get("reasoning") or ai_result.get("error"),
            considered=candidates,
        ).model_dump()
        base["error"] = (
            ai_result.get("error") or ai_result.get("reasoning") or "No safe candidate selected"
        )
        await healing_service.save_attempt(db, HealingAttempt.model_validate(base))
        return _to_out(base)

    chosen = candidates[idx]
    validation = await healing_service.validate_candidate(target_url, path, chosen.selector)
    confidence = float(ai_result.get("confidence") or 0)
    if validation.selector_found_on_page is False:
        confidence = 0.0

    status = "pending" if confidence >= 70 and validation.selector_found_on_page else "failed"
    error = None
    if status == "failed":
        if validation.selector_found_on_page is False:
            error = (
                validation.error
                or "Candidate selector was not found on the live page during validation"
            )
        else:
            error = "Confidence below 70 not proposing apply"

    base.update(
        {
            "candidate": HealingCandidate(
                selector=chosen.selector,
                source="dom_scan_ai_ranked",
                reasoning=ai_result.get("reasoning"),
                considered=candidates,
            ).model_dump(),
            "validation": validation.model_dump(),
            "confidence": confidence,
            "status": status,
            "error": error,
        }
    )
    await healing_service.save_attempt(db, HealingAttempt.model_validate(base))
    return _to_out(base)


@router.get("")
async def list_healing_attempts(
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    docs = await healing_service.list_attempts(db, org.id)
    summary_raw = await healing_service.compute_summary(db, org.id)
    summary = HealingSummaryOut(
        broken_tests=summary_raw["broken_tests"],
        healed_successfully=summary_raw["healed_successfully"],
        pending_review=summary_raw["pending_review"],
        failed_healing=summary_raw["failed_healing"],
        healing_success_rate=summary_raw["healing_success_rate"],
    )
    return {"summary": summary.model_dump(), "items": [_list_item(d) for d in docs]}


@router.get("/{attempt_id}", response_model=HealingAttemptOut)
async def get_healing_attempt(
    attempt_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await healing_service.get_attempt(db, org.id, attempt_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Healing attempt not found")
    return _to_out(doc)


@router.post("/{attempt_id}/validate", response_model=HealingAttemptOut)
async def revalidate_healing(
    attempt_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await healing_service.get_attempt(db, org.id, attempt_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Healing attempt not found")
    selector = (doc.get("candidate") or {}).get("selector")
    if not selector:
        raise HTTPException(status_code=400, detail="No candidate selector to validate")

    validation = await healing_service.validate_candidate(doc["target_url"], "/", selector)
    confidence = float(doc.get("confidence") or 0)
    if validation.selector_found_on_page is False:
        confidence = 0.0
    doc["validation"] = validation.model_dump()
    doc["confidence"] = confidence
    await healing_service.save_attempt(db, HealingAttempt.model_validate(doc))
    return _to_out(doc)


@router.post("/{attempt_id}/approve", response_model=HealingAttemptOut)
async def approve_healing(
    attempt_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await healing_service.get_attempt(db, org.id, attempt_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Healing attempt not found")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only pending attempts can be approved")
    selector = (doc.get("candidate") or {}).get("selector")
    if not selector:
        raise HTTPException(status_code=400, detail="No candidate selector to apply")

    ok = await healing_service.apply_healed_selector(
        db, org.id, doc["test_id"], doc["step_number"], selector
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Could not apply selector test or step not found in playwright_tests",
        )

    doc["status"] = "approved"
    doc["decided_at"] = datetime.utcnow()
    await healing_service.save_attempt(db, HealingAttempt.model_validate(doc))
    return _to_out(doc)


@router.post("/{attempt_id}/reject", response_model=HealingAttemptOut)
async def reject_healing(
    attempt_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await healing_service.get_attempt(db, org.id, attempt_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Healing attempt not found")
    doc["status"] = "rejected"
    doc["decided_at"] = datetime.utcnow()
    await healing_service.save_attempt(db, HealingAttempt.model_validate(doc))
    return _to_out(doc)
