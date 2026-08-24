"""
Self-Healing Tests live DOM scanning, candidate validation, and the
approved write-back into playwright_tests.

Never invents a selector: scan_page_elements only returns elements it
actually observed on the live page; the AI (in ai_service.py) picks among
those by index. validate_candidate re-checks the chosen selector against
the live page before anything is ever proposed as healed.
"""
import difflib
import logging
from typing import Optional

from app.models.healing import DomElementCandidate, HealingAttempt, ValidationResult

log = logging.getLogger("healing_service")

COLLECTION = "healing_attempts"

_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=swiftshader",
    "--enable-webgl",
    "--allow-insecure-localhost",
    "--window-size=1280,720",
]


def _full_url(target_url: str, path: str) -> str:
    p = path if path.startswith("/") else f"/{path}" if path else "/"
    return target_url.rstrip("/") + p


async def scan_page_elements(target_url: str, path: str, limit: int = 40) -> list[DomElementCandidate]:
    """Real live scan returns only elements actually present. Fails closed."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log.warning("Healing: Playwright not installed")
        return []

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            try:
                ctx = await browser.new_context(
                    viewport={"width": 1280, "height": 720},
                    ignore_https_errors=True,
                )
                page = await ctx.new_page()
                await page.goto(
                    _full_url(target_url, path),
                    wait_until="domcontentloaded",
                    timeout=15_000,
                )
                try:
                    await page.wait_for_load_state("networkidle", timeout=8_000)
                except Exception:
                    pass

                elements = await page.eval_on_selector_all(
                    "button, a, input, select, textarea, [role], [id]",
                    """(els) => els.slice(0, 60).map((el, i) => ({
                        tag: el.tagName.toLowerCase(),
                        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60),
                        role: el.getAttribute('role'),
                        id: el.id || null,
                        idx: i,
                    }))""",
                )
                out: list[DomElementCandidate] = []
                for el in elements[:limit]:
                    if el.get("id"):
                        selector = f"#{el['id']}"
                    else:
                        selector = f"{el['tag']}:nth-of-type({el['idx'] + 1})"
                    out.append(
                        DomElementCandidate(
                            selector=selector,
                            tag=el["tag"],
                            text=el.get("text") or None,
                            role=el.get("role"),
                            element_id=el.get("id"),
                        )
                    )
                return out
            finally:
                await browser.close()
    except Exception as exc:
        log.warning("Healing: DOM scan failed for %s%s: %s", target_url, path, exc)
        return []


async def validate_candidate(target_url: str, path: str, selector: str) -> ValidationResult:
    """Re-checks a candidate selector against the live page. Never raises."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ValidationResult(
            attempted=True,
            selector_found_on_page=False,
            error="Playwright not installed",
        )

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            try:
                ctx = await browser.new_context(
                    viewport={"width": 1280, "height": 720},
                    ignore_https_errors=True,
                )
                page = await ctx.new_page()
                await page.goto(
                    _full_url(target_url, path),
                    wait_until="domcontentloaded",
                    timeout=15_000,
                )
                count = await page.locator(selector).count()
                return ValidationResult(attempted=True, selector_found_on_page=count > 0)
            finally:
                await browser.close()
    except Exception as exc:
        return ValidationResult(
            attempted=True,
            selector_found_on_page=False,
            error=str(exc)[:300],
        )


def build_healing_diff(original_selector: str, candidate_selector: str) -> str:
    return "\n".join(
        difflib.unified_diff(
            [f'page.locator("{original_selector}")'],
            [f'page.locator("{candidate_selector}")'],
            lineterm="",
            n=0,
        )
    )


async def save_attempt(db, attempt: HealingAttempt) -> None:
    doc = attempt.model_dump(by_alias=True)
    await db[COLLECTION].replace_one(
        {"_id": doc["_id"], "org_id": doc["org_id"]},
        doc,
        upsert=True,
    )


async def get_attempt(db, org_id: str, attempt_id: str) -> Optional[dict]:
    return await db[COLLECTION].find_one({"_id": attempt_id, "org_id": org_id})


async def list_attempts(db, org_id: str, limit: int = 50) -> list[dict]:
    cursor = db[COLLECTION].find({"org_id": org_id}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index([("org_id", 1), ("created_at", -1)])
        await db[COLLECTION].create_index(
            [("org_id", 1), ("run_id", 1), ("test_id", 1), ("step_number", 1)]
        )
    except Exception as exc:
        log.warning("healing index creation failed (non-fatal): %s", exc)


async def compute_summary(db, org_id: str) -> dict:
    docs = await list_attempts(db, org_id, limit=500)
    broken = len(docs)
    healed = sum(1 for d in docs if d.get("status") == "approved")
    pending = sum(1 for d in docs if d.get("status") == "pending")
    failed = sum(1 for d in docs if d.get("status") in ("failed", "rejected"))
    decided = healed + failed
    return {
        "broken_tests": broken,
        "healed_successfully": healed,
        "pending_review": pending,
        "failed_healing": failed,
        "healing_success_rate": round((healed / decided) * 100, 1) if decided else None,
    }


async def apply_healed_selector(
    db, org_id: str, test_id: str, step_number: int, new_selector: str
) -> bool:
    """Writes the healed selector into playwright_tests after explicit approval."""
    doc = await db.playwright_tests.find_one({"_id": test_id, "org_id": org_id})
    if not doc:
        return False
    steps = doc.get("steps", [])
    idx = step_number - 1
    if idx < 0 or idx >= len(steps):
        return False
    steps[idx]["selector"] = new_selector
    await db.playwright_tests.update_one(
        {"_id": test_id, "org_id": org_id},
        {"$set": {"steps": steps}},
    )
    return True
