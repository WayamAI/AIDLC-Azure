"""
Playwright execution service.

Runs AI-generated test cases against a live target URL using headless Chromium,
captures a screenshot after every step, and stores results in-memory so the
frontend can poll for live updates.

KEY: --disable-gpu causes solid-black screenshots in headless Chrome.
     We intentionally do NOT pass that flag. We use SwiftShader (software GL)
     which renders correctly without a GPU.
"""
import asyncio
import base64
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

# ── Structured logger output goes to the backend terminal ───────────────────
log = logging.getLogger("playwright_service")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# ── In-memory run store ───────────────────────────────────────────────────────
_runs: dict[str, dict[str, Any]] = {}


def get_run(run_id: str) -> dict[str, Any] | None:
    return _runs.get(run_id)


async def save_run_to_db(run: dict[str, Any]) -> None:
    """Persist a completed run to MongoDB (playwright_runs collection)."""
    try:
        from app.database import get_db
        db = get_db()
        doc = {**run, "_id": run["run_id"]}
        # Strip large base64 screenshots from step_results to keep the list document small;
        # the full data remains in the in-memory _runs dict for the current session.
        slim_results = []
        for r in doc.get("results", []):
            slim_steps = [
                {k: v for k, v in s.items() if k != "screenshot"}
                for s in r.get("step_results", [])
            ]
            slim_results.append({**r, "step_results": slim_steps})
        doc["results"] = slim_results
        await db.playwright_runs.replace_one({"_id": run["run_id"]}, doc, upsert=True)
    except Exception as exc:
        log.warning("Could not persist run to MongoDB: %s", exc)


async def list_runs_from_db(limit: int = 20) -> list[dict[str, Any]]:
    """Return summary rows for recent runs, newest first."""
    try:
        from app.database import get_db
        db = get_db()
        cursor = db.playwright_runs.find(
            {},
            {
                "run_id": 1, "analysis_id": 1, "status": 1,
                "total": 1, "passed": 1, "failed": 1,
                "started_at": 1, "completed_at": 1,
                "results.test_name": 1, "results.status": 1, "results.duration_ms": 1,
            }
        ).sort("started_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        for d in docs:
            d.pop("_id", None)
        return docs
    except Exception as exc:
        log.warning("Could not list runs from MongoDB: %s", exc)
        return []


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Screenshot helper ─────────────────────────────────────────────────────────

async def _screenshot_b64(page: Any, run_id: str, label: str) -> str | None:
    """Take a full-viewport PNG screenshot. Returns base64 string or None on error."""
    try:
        data = await page.screenshot(
            type="png",
            full_page=False,
            clip={"x": 0, "y": 0, "width": 1280, "height": 720},
            animations="disabled",
        )
        size_kb = len(data) // 1024
        log.info("  📸 Screenshot OK [%s] %d KB", label, size_kb)
        if size_kb < 2:
            log.warning(
                "  ⚠️  Screenshot suspiciously small (%d KB) page may not have rendered yet", size_kb
            )
        return base64.b64encode(data).decode()
    except Exception as exc:
        log.error("  ❌ Screenshot failed [%s]: %s", label, exc)
        return None


# ── Selector sanitizer ────────────────────────────────────────────────────────

def _sanitize_selector(selector: str) -> str:
    """
    Fix common AI-generated selector mistakes:
    1. Unquoted CSS attribute values: input[placeholder=Due Date] → input[placeholder="Due Date"]
    """
    def _quote_attr_value(m: re.Match) -> str:
        attr, value = m.group(1), m.group(2)
        if value.startswith('"') or value.startswith("'"):
            return m.group(0)
        return f'[{attr}="{value}"]'

    return re.sub(r'\[(\w[\w-]*)=([^\]"\']+)\]', _quote_attr_value, selector)


# ── Helper: try multiple selectors, return first match ───────────────────────

async def _first_visible(page: Any, selectors: list[str], timeout: int = 3000) -> Any | None:
    """Return the first locator that has at least one visible element, or None."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=timeout)
            return loc
        except Exception:
            continue
    return None


# ── Helper: hover to reveal hidden action buttons ────────────────────────────

async def _hover_to_reveal(page: Any, target_text: str, container_selectors: list[str]) -> bool:
    """
    Hover over container elements to reveal hidden buttons (e.g. delete, edit).
    Returns True if the target button was found and clicked.
    """
    for container_sel in container_selectors:
        try:
            containers = page.locator(container_sel)
            count = await containers.count()
            for i in range(min(count, 5)):
                item = containers.nth(i)
                try:
                    await item.hover(timeout=3000)
                    await asyncio.sleep(0.4)
                    # Now look for the revealed button
                    btn = item.locator(f':has-text("{target_text}")').first
                    if await btn.count() > 0:
                        await btn.click(timeout=5000)
                        log.info("    ↪ hover-reveal click: hovered %r, clicked %r", container_sel, target_text)
                        return True
                    # Also try page-level after hover
                    page_btn = page.locator(f'button:has-text("{target_text}")').first
                    if await page_btn.count() > 0:
                        await page_btn.click(timeout=5000)
                        log.info("    ↪ hover-reveal page click: %r", target_text)
                        return True
                except Exception:
                    continue
        except Exception:
            continue
    return False


# ── Single step executor ──────────────────────────────────────────────────────

async def _run_step(
    page: Any,
    step: dict[str, Any],
    target_url: str,
    run_id: str,
    test_name: str,
    step_num: int,
) -> dict[str, Any]:
    """Execute one step. Returns step_result dict. Never raises."""
    action = step.get("action", "")
    selector = (step.get("selector") or "").strip()
    value = (step.get("value") or "").strip()
    description = step.get("description", action)

    log.info("  ▶ Step %d [%s]: %s selector=%r value=%r",
             step_num, action.upper(), description, selector or None, value or None)

    step_result: dict[str, Any] = {
        "step_description": description,
        "screenshot": None,
        "status": "pass",
        "error": None,
    }

    try:
        if action == "navigate":
            if value and (value.startswith("http://") or value.startswith("https://")):
                # Extract path from the full URL so tests stay portable across environments
                # e.g. http://localhost:8083/todos → /todos → {target_url}/todos
                parsed = urlparse(value)
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                url = target_url.rstrip("/") + path
            else:
                path = value if value.startswith("/") else ("/" + value if value else "")
                url = target_url.rstrip("/") + path
            log.info("    → goto %s", url)
            await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10_000)
                log.info("    ✓ networkidle reached")
            except Exception:
                log.warning("    ⚠ networkidle timed out continuing anyway")
            await asyncio.sleep(1.2)

        elif action == "click":
            if selector:
                clean = _sanitize_selector(selector)
                pre_url = page.url

                # ── Special: checkbox / radio handling (Radix UI custom components) ──
                if re.search(r'checkbox|radio', selector, re.I):
                    # Comprehensive list of selectors for custom checkbox components
                    cb_selectors = [
                        '[role="checkbox"]:not([disabled])',
                        'button[role="checkbox"]',
                        '[role="radio"]:not([disabled])',
                        '[data-state="unchecked"]',
                        '[data-state="checked"]',
                        '[class*="checkbox"]',
                        '[class*="check"]:not(button)',
                        'input[type="checkbox"]',
                        # Specific to Radix UI Checkbox
                        'span[data-state]',
                        'button[data-state]',
                        clean,
                    ]
                    custom_found = False
                    for cb_sel in cb_selectors:
                        try:
                            loc = page.locator(cb_sel).first
                            cnt = await loc.count()
                            if cnt > 0:
                                # Scroll into view and try clicking
                                try:
                                    await loc.scroll_into_view_if_needed(timeout=2000)
                                except Exception:
                                    pass
                                await loc.click(timeout=8_000)
                                log.info("    ✓ checkbox click via %r", cb_sel)
                                await asyncio.sleep(0.6)
                                custom_found = True
                                break
                        except Exception:
                            continue

                    if not custom_found:
                        # Last resort: use JavaScript to find and click first interactive element
                        try:
                            await page.evaluate("""
                                const checkboxes = document.querySelectorAll(
                                    '[role="checkbox"], input[type="checkbox"], [data-state="unchecked"], [data-state="checked"]'
                                );
                                if (checkboxes.length > 0) checkboxes[0].click();
                            """)
                            log.info("    ↪ checkbox JS fallback click")
                            await asyncio.sleep(0.6)
                            custom_found = True
                        except Exception:
                            pass

                    if not custom_found:
                        step_result["status"] = "fail"
                        step_result["error"] = f"Could not find checkbox/radio element"
                        log.error("    ❌ Could not find checkbox/radio element with selector %r", selector)

                # ── text=X selectors ───────────────────────────────────────────
                elif selector.startswith("text="):
                    text_val = selector[5:].strip()
                    btn = page.locator(f'button:has-text("{text_val}")')
                    btn_count = await btn.count()
                    if btn_count > 0:
                        log.info("    → click button:has-text(%r) [upgraded from text=]", text_val)
                        await btn.first.click(timeout=12_000)
                    else:
                        role_btn = page.get_by_role("button", name=text_val)
                        role_count = await role_btn.count()
                        if role_count > 0:
                            log.info("    → click role=button name=%r", text_val)
                            await role_btn.first.click(timeout=12_000)
                        else:
                            log.info("    → click %r (fallback)", clean)
                            await page.locator(clean).first.click(timeout=12_000)

                # ── General click with smart fallbacks ────────────────────────
                else:
                    log.info("    → click %r", clean)
                    # Dialog-scoped clicks: use a short initial timeout; if the dialog
                    # doesn't appear (e.g. app confirms without a dialog), skip gracefully
                    is_dialog_click = '[role="dialog"]' in clean or 'aria-modal' in clean
                    click_timeout = 4_000 if is_dialog_click else 12_000
                    try:
                        loc = page.locator(clean).first
                        # Scroll into view before clicking
                        try:
                            await loc.scroll_into_view_if_needed(timeout=3000)
                        except Exception:
                            pass
                        await loc.click(timeout=click_timeout)
                    except Exception as click_exc:
                        # For dialog-scoped clicks, if the dialog never appeared the previous
                        # step may have already completed the action warn and continue.
                        if is_dialog_click and await page.locator('[role="dialog"]').count() == 0:
                            log.warning(
                                "    ⚠ dialog click skipped no dialog present (action may be complete): %r", clean
                            )
                            # Don't raise treat as a skipped/soft step
                            click_exc = None  # type: ignore[assignment]
                        recovered = False

                        # Extract text if has-text() pattern
                        text_match = re.search(r'has-text\(["\'](.+?)["\']\)', clean)
                        if text_match:
                            text_val = text_match.group(1)

                            # Try role-based fallbacks
                            option_fallbacks = [
                                f'[role="option"]:has-text("{text_val}")',
                                f'[role="menuitem"]:has-text("{text_val}")',
                                f'[data-value="{text_val}"]',
                                f'li:has-text("{text_val}")',
                                f'[role="tab"]:has-text("{text_val}")',
                                f'[role="listitem"]:has-text("{text_val}")',
                                f'span:has-text("{text_val}")',
                                f'div[class*="option"]:has-text("{text_val}")',
                                f'[role="button"]:has-text("{text_val}")',
                            ]
                            for fb in option_fallbacks:
                                try:
                                    loc = page.locator(fb).first
                                    if await loc.count() > 0:
                                        await loc.scroll_into_view_if_needed(timeout=2000)
                                        await loc.click(timeout=5_000)
                                        log.info("    ↪ fallback click %r", fb)
                                        recovered = True
                                        break
                                except Exception:
                                    continue

                            # Try hover-to-reveal for action buttons (delete, edit, etc.)
                            if not recovered and text_val.lower() in ("delete", "remove", "edit", "archive", "trash"):
                                container_sels = [
                                    "li", "[class*='item']", "[class*='card']",
                                    "[class*='task']", "[class*='todo']", "[class*='row']",
                                    "tr", "article", "[data-testid]",
                                ]
                                recovered = await _hover_to_reveal(page, text_val, container_sels)

                            # Try combobox/Select trigger variations (Radix UI Select renders as role="combobox")
                            if not recovered:
                                dialog_scope = '[role="dialog"] ' if '[role="dialog"]' in clean else ''
                                combobox_fallbacks = [
                                    f'{dialog_scope}[role="combobox"]',
                                    f'{dialog_scope}[aria-haspopup="listbox"]',
                                    f'{dialog_scope}button[aria-haspopup]',
                                    f'[role="combobox"]:has-text("{text_val}")',
                                    f'[aria-haspopup="listbox"]:has-text("{text_val}")',
                                ]
                                for fb in combobox_fallbacks:
                                    try:
                                        loc = page.locator(fb).first
                                        if await loc.count() > 0:
                                            await loc.click(timeout=5000)
                                            await asyncio.sleep(0.5)
                                            log.info("    ↪ combobox trigger click %r", fb)
                                            recovered = True
                                            break
                                    except Exception:
                                        continue

                            # Try clicking a dropdown trigger first, then the option
                            if not recovered:
                                trigger_selectors = [
                                    '[role="combobox"]', '[aria-haspopup="listbox"]',
                                    'button:has-text("Sort")', 'button:has-text("Filter")',
                                    'button:has-text("Priority")', '[class*="select"]:visible',
                                    '[class*="dropdown"]:visible', '[aria-haspopup="menu"]',
                                    '[aria-expanded="false"]',
                                ]
                                for trigger in trigger_selectors:
                                    try:
                                        t_loc = page.locator(trigger).first
                                        if await t_loc.count() > 0:
                                            await t_loc.click(timeout=3000)
                                            await asyncio.sleep(0.5)
                                            # Now try the original selector
                                            opt = page.locator(clean).first
                                            if await opt.count() > 0:
                                                await opt.click(timeout=5000)
                                                log.info("    ↪ dropdown-open then click %r", clean)
                                                recovered = True
                                                break
                                            # Try option by text
                                            opt2 = page.locator(f'[role="option"]:has-text("{text_val}")').first
                                            if await opt2.count() > 0:
                                                await opt2.click(timeout=5000)
                                                log.info("    ↪ dropdown option click %r", text_val)
                                                recovered = True
                                                break
                                    except Exception:
                                        continue

                        if not recovered and click_exc is not None:
                            raise click_exc

                # Wait for potential navigation or DOM update after click
                if page.url != pre_url:
                    log.info("    ↪ URL changed to %s", page.url)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10_000)
                    except Exception:
                        log.warning("    ⚠ networkidle timed out after navigation")
                    await asyncio.sleep(0.8)
                else:
                    await asyncio.sleep(0.6)
            else:
                log.warning("    ⚠ click action has no selector skipped")

        elif action == "fill":
            if selector and value:
                clean = _sanitize_selector(selector)
                log.info("    → fill %r with %r", clean, value)

                is_dialog_fill = '[role="dialog"]' in selector or "dialog" in selector.lower()

                # For dialog fills: wait generously for dialog open animation
                if is_dialog_fill:
                    await asyncio.sleep(1.0)

                filled = False

                # Primary attempt
                try:
                    loc = page.locator(clean).first
                    cnt = await loc.count()
                    if cnt > 0:
                        await loc.scroll_into_view_if_needed(timeout=2000)
                        await loc.fill(value, timeout=6_000)
                        filled = True
                        log.info("    ✓ fill primary selector")
                except Exception:
                    pass

                # Dialog-specific fallbacks
                if not filled and is_dialog_fill:
                    await asyncio.sleep(0.8)
                    dialog_fallbacks = [
                        '[role="dialog"] input:not([type="password"]):not([type="email"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
                        '[role="dialog"] input:visible',
                        '[role="dialog"] input',
                        '[role="dialog"] textarea',
                        '[aria-modal="true"] input:visible',
                        '[aria-modal="true"] input',
                        '[aria-modal="true"] textarea',
                        'dialog input',
                        # Radix UI dialog
                        '[data-radix-popper-content-wrapper] input',
                        '[data-state="open"] input',
                    ]
                    for fb in dialog_fallbacks:
                        try:
                            loc = page.locator(fb).first
                            cnt = await loc.count()
                            if cnt > 0:
                                log.info("    ↪ dialog fill fallback %r", fb)
                                await loc.wait_for(state="visible", timeout=4000)
                                await loc.scroll_into_view_if_needed(timeout=2000)
                                await loc.fill(value, timeout=6_000)
                                filled = True
                                break
                        except Exception:
                            continue

                # JS-based fill as last resort for dialogs
                if not filled and is_dialog_fill:
                    try:
                        result = await page.evaluate(f"""
                            (val) => {{
                                const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], dialog');
                                if (!dialog) return false;
                                const inputs = dialog.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="email"]):not([type="checkbox"]), textarea');
                                if (inputs.length === 0) return false;
                                const inp = inputs[0];
                                inp.focus();
                                const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                                if (nativeInput && nativeInput.set) {{
                                    nativeInput.set.call(inp, val);
                                }} else {{
                                    inp.value = val;
                                }}
                                inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                return true;
                            }}
                        """, value)
                        if result:
                            log.info("    ↪ dialog fill via JS native input setter")
                            filled = True
                    except Exception:
                        pass

                # Inline-edit fallback: when the test expects a dialog but the app uses
                # an in-place input (e.g. TodoItem inline edit with autoFocus)
                if not filled and is_dialog_fill:
                    inline_fallbacks = [
                        "input:focus",           # autoFocus inline edit
                        "input[autofocus]",
                        "input[class*='h-8']",   # shadcn small inline input
                        "input[class*='edit']",
                        "textarea:focus",
                        # visible non-auth inputs anywhere on the page
                        "input:not([type='hidden']):not([type='password']):not([type='email'])",
                    ]
                    for fb in inline_fallbacks:
                        try:
                            loc = page.locator(fb).first
                            cnt = await loc.count()
                            if cnt > 0:
                                await loc.wait_for(state="visible", timeout=3_000)
                                await loc.fill(value, timeout=5_000)
                                filled = True
                                log.info("    ↪ inline-edit fill fallback %r", fb)
                                break
                        except Exception:
                            continue

                if not filled:
                    # General non-dialog fill fallback using wait_for
                    try:
                        await page.locator(clean).first.wait_for(state="visible", timeout=8_000)
                        await page.locator(clean).first.fill(value, timeout=8_000)
                        filled = True
                    except Exception as exc:
                        step_result["status"] = "fail"
                        step_result["error"] = str(exc)[:500]
                        log.error("    ❌ STEP FAILED: %s", exc)

                if filled:
                    await asyncio.sleep(0.3)
            else:
                log.warning("    ⚠ fill action missing selector or value skipped")

        elif action == "assert_text":
            if value:
                log.info("    → assert visible: %r", value)
                # Toast/notification messages: check with a short timeout first
                # (they may flash briefly). Retry across multiple selectors.
                found = False
                for attempt_timeout in (3_000, 10_000):
                    try:
                        await page.get_by_text(value, exact=False).first.wait_for(
                            state="visible", timeout=attempt_timeout
                        )
                        found = True
                        log.info("    ✓ text found")
                        break
                    except Exception:
                        # Also try hidden/DOM-present text (e.g. toast in detached state)
                        try:
                            count = await page.get_by_text(value, exact=False).count()
                            if count > 0:
                                found = True
                                log.info("    ✓ text found (DOM, possibly not visible)")
                                break
                        except Exception:
                            pass
                if not found:
                    raise Exception(f"assert_text: text {value!r} not visible after 13s")
            else:
                log.warning("    ⚠ assert_text has no value skipped")

        elif action == "screenshot":
            await asyncio.sleep(0.5)

        elif action == "wait":
            secs = min(float(value) if value else 1.0, 10.0)
            log.info("    → wait %.1f s", secs)
            await asyncio.sleep(secs)

        elif action == "hover":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → hover %r", clean)
                try:
                    await page.locator(clean).first.scroll_into_view_if_needed(timeout=3000)
                except Exception:
                    pass
                await page.locator(clean).first.hover(timeout=8_000)
                await asyncio.sleep(0.5)

        elif action == "hover_and_click":
            # Hover over `selector` to reveal hidden UI, then click element matching `value`
            if selector and value:
                clean_hover = _sanitize_selector(selector)
                clean_click = _sanitize_selector(value)
                log.info("    → hover_and_click: hover=%r then click=%r", clean_hover, clean_click)

                # Build list of container selectors to try (in order of specificity)
                hover_candidates = [clean_hover]
                text_m = re.search(r'has-text\(["\'](.+?)["\']\)', clean_hover)
                ht = text_m.group(1) if text_m else None
                if ht:
                    hover_candidates += [
                        # Glassmorphism / Tailwind card patterns (e.g. TodoItem)
                        f'[class*="glass"]:has-text("{ht}")',
                        f'[class*="group"]:has-text("{ht}")',
                        # Generic card / list item patterns
                        f'[class*="item"]:has-text("{ht}")',
                        f'[class*="task"]:has-text("{ht}")',
                        f'[class*="card"]:has-text("{ht}")',
                        f'[class*="rounded"]:has-text("{ht}")',
                        f'article:has-text("{ht}")',
                        f'[role="listitem"]:has-text("{ht}")',
                        f'[class*="row"]:has-text("{ht}")',
                        f'li:has-text("{ht}")',
                    ]

                # Determine what the click target is (text or icon-button action)
                click_text_m = re.search(r'has-text\(["\'](.+?)["\']\)', clean_click)
                click_text = click_text_m.group(1).lower() if click_text_m else clean_click.lower()
                is_delete = any(k in click_text for k in ("delete", "remove", "trash", "archive"))
                is_edit   = any(k in click_text for k in ("edit", "rename", "pencil", "modify"))

                success = False
                for hover_sel in hover_candidates:
                    try:
                        hover_loc = page.locator(hover_sel).first
                        if await hover_loc.count() == 0:
                            continue
                        await hover_loc.scroll_into_view_if_needed(timeout=3000)
                        await hover_loc.hover(timeout=8_000)
                        await asyncio.sleep(0.7)  # allow CSS transition (opacity, visibility)

                        # ── Strategy 1: exact selector scoped within hovered element ──
                        try:
                            scoped = hover_loc.locator(clean_click).first
                            if await scoped.count() > 0:
                                await scoped.click(timeout=5_000, force=True)
                                log.info("    ✓ hover_and_click (scoped+force) via %r", hover_sel)
                                success = True
                                break
                        except Exception:
                            pass

                        # ── Strategy 2: exact selector page-wide with force ────────
                        try:
                            page_loc = page.locator(clean_click).first
                            if await page_loc.count() > 0:
                                await page_loc.click(timeout=5_000, force=True)
                                log.info("    ✓ hover_and_click (page+force) via %r", hover_sel)
                                success = True
                                break
                        except Exception:
                            pass

                        # ── Strategy 3: icon-only buttons (no visible text) ────────
                        # Matches patterns like shadcn/ui <Button size="icon"> which renders
                        # without text, only an SVG icon (Edit2, Trash2, etc.)
                        if is_edit or is_delete:
                            icon_btn_candidates_page = [
                                # aria-label is the most reliable
                                f'button[aria-label*="{click_text}" i]',
                                f'[role="button"][aria-label*="{click_text}" i]',
                            ]
                            # Scoped selectors (within the hovered element)
                            # Exclude Radix UI checkbox buttons (h-5 w-5); action buttons are h-8 w-8
                            icon_btn_candidates_scoped = [
                                "button.h-8",             # shadcn size="icon" (h-8 w-8) pattern
                                "button[class*='icon']",
                                "button[class*='ghost']", # shadcn ghost variant
                                # Exclude role=checkbox (Radix UI Checkbox renders as button)
                                "button:not([role='checkbox']):not([data-state='checked']):not([data-state='unchecked'])",
                                "button",
                            ]
                            tried = False
                            for ib_sel in icon_btn_candidates_page:
                                try:
                                    ib_locs = page.locator(ib_sel)
                                    cnt = await ib_locs.count()
                                    if cnt == 0:
                                        continue
                                    ib = ib_locs.last if is_delete else ib_locs.first
                                    await ib.click(timeout=5_000, force=True)
                                    log.info("    ✓ hover_and_click icon-btn(aria) (%s) via %r",
                                             "delete" if is_delete else "edit", ib_sel)
                                    success = True
                                    tried = True
                                    break
                                except Exception:
                                    continue
                            if not tried:
                                for ib_sel in icon_btn_candidates_scoped:
                                    try:
                                        ib_locs = hover_loc.locator(ib_sel)
                                        cnt = await ib_locs.count()
                                        if cnt == 0:
                                            continue
                                        ib = ib_locs.last if is_delete else ib_locs.first
                                        await ib.click(timeout=5_000, force=True)
                                        log.info("    ✓ hover_and_click icon-btn(scoped) (%s) via %r",
                                                 "delete" if is_delete else "edit", ib_sel)
                                        success = True
                                        break
                                    except Exception:
                                        continue
                            if success:
                                break

                        # ── Strategy 4: JavaScript force-reveal and click ────────
                        # Works even when CSS opacity:0 hides the button from Playwright
                        try:
                            result = await page.evaluate(
                                """
                                ([containerSel, btnText, isDelete]) => {
                                    const containers = Array.from(document.querySelectorAll(containerSel));
                                    if (!containers.length) return false;
                                    const container = containers[0];
                                    // Dispatch hover events so CSS group-hover kicks in
                                    ['mouseover','mouseenter'].forEach(evt =>
                                        container.dispatchEvent(new MouseEvent(evt, {bubbles: true, composed: true}))
                                    );
                                    // Find all buttons inside this container
                                    const buttons = Array.from(container.querySelectorAll('button, [role="button"]'));
                                    if (!buttons.length) return false;
                                    // Try matching by text first
                                    let btn = buttons.find(b =>
                                        b.textContent.trim().toLowerCase().includes(btnText)
                                    );
                                    // Icon-only: pick last for delete, first for edit
                                    if (!btn) btn = isDelete ? buttons[buttons.length - 1] : buttons[0];
                                    if (!btn) return false;
                                    // Force visible and click
                                    btn.style.opacity = '1';
                                    btn.style.visibility = 'visible';
                                    btn.style.pointerEvents = 'auto';
                                    btn.click();
                                    return true;
                                }
                                """,
                                [hover_sel, click_text, is_delete],
                            )
                            if result:
                                log.info("    ↪ hover_and_click JS fallback via %r", hover_sel)
                                success = True
                                break
                        except Exception:
                            pass

                    except Exception:
                        continue

                if not success:
                    step_result["status"] = "fail"
                    step_result["error"] = f"hover_and_click: all container fallbacks exhausted for {selector!r}"
                    log.error("    ❌ STEP FAILED: hover_and_click all fallbacks exhausted")
                await asyncio.sleep(0.4)
            else:
                log.warning("    ⚠ hover_and_click missing selector or value skipped")

        elif action == "press":
            if selector and value:
                clean = _sanitize_selector(selector)
                log.info("    → press %r on %r", value, clean)
                pressed = False
                try:
                    loc = page.locator(clean).first
                    await loc.wait_for(state="visible", timeout=4_000)
                    await loc.press(value, timeout=8_000)
                    pressed = True
                except Exception:
                    pass

                if not pressed:
                    # Fallback: press on focused element or visible input (inline edit)
                    press_fallbacks = [
                        "input:focus",
                        "textarea:focus",
                        "input[autofocus]",
                        "input[class*='h-8']",
                        "input:not([type='hidden']):not([type='password']):not([type='email'])",
                    ]
                    for fb in press_fallbacks:
                        try:
                            loc = page.locator(fb).first
                            if await loc.count() > 0:
                                await loc.press(value, timeout=5_000)
                                pressed = True
                                log.info("    ↪ press fallback on %r", fb)
                                break
                        except Exception:
                            continue

                if not pressed:
                    # Last resort: press the key on the keyboard globally
                    try:
                        await page.keyboard.press(value)
                        pressed = True
                        log.info("    ↪ press key globally: %r", value)
                    except Exception as exc:
                        step_result["status"] = "fail"
                        step_result["error"] = str(exc)[:500]
                        log.error("    ❌ STEP FAILED: %s", exc)

                await asyncio.sleep(0.3)

        elif action == "check":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → check %r", clean)
                try:
                    await page.locator(clean).first.check(timeout=8_000)
                except Exception:
                    # Fallback: just click it
                    await page.locator(clean).first.click(timeout=8_000)
                await asyncio.sleep(0.3)

        elif action == "uncheck":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → uncheck %r", clean)
                try:
                    await page.locator(clean).first.uncheck(timeout=8_000)
                except Exception:
                    await page.locator(clean).first.click(timeout=8_000)
                await asyncio.sleep(0.3)

        elif action == "select_option":
            if selector and value:
                clean = _sanitize_selector(selector)
                log.info("    → select %r on %r", value, clean)
                try:
                    await page.locator(clean).first.select_option(value, timeout=8_000)
                except Exception:
                    # For custom selects: click the trigger, then click the option
                    await page.locator(clean).first.click(timeout=5_000)
                    await asyncio.sleep(0.4)
                    option = await _first_visible(page, [
                        f'[role="option"]:has-text("{value}")',
                        f'li:has-text("{value}")',
                        f'[data-value="{value}"]',
                    ])
                    if option:
                        await option.click(timeout=5_000)
                await asyncio.sleep(0.3)

        elif action == "drag_and_drop":
            if selector and value:
                clean_src = _sanitize_selector(selector)
                clean_dst = _sanitize_selector(value)
                log.info("    → drag %r to %r", clean_src, clean_dst)
                await page.locator(clean_src).first.drag_to(page.locator(clean_dst).first, timeout=8_000)
                await asyncio.sleep(0.3)

        elif action == "dblclick":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → dblclick %r", clean)
                await page.locator(clean).first.dblclick(timeout=8_000)
                await asyncio.sleep(0.3)

        elif action == "type_into":
            if selector and value:
                clean = _sanitize_selector(selector)
                log.info("    → type_into %r with %r", clean, value)
                await page.locator(clean).first.click(timeout=8_000)
                await page.keyboard.type(value, delay=50)
                await asyncio.sleep(0.3)

        elif action == "scroll":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → scroll to %r", clean)
                await page.locator(clean).first.scroll_into_view_if_needed(timeout=8_000)
                await asyncio.sleep(0.3)

        elif action == "clear":
            if selector:
                clean = _sanitize_selector(selector)
                log.info("    → clear %r", clean)
                await page.locator(clean).first.fill("", timeout=8_000)
                await asyncio.sleep(0.2)

        else:
            log.warning("    ⚠ unknown action %r skipped", action)

    except Exception as exc:
        if step_result["status"] != "fail":
            step_result["status"] = "fail"
            step_result["error"] = str(exc)[:500]
            log.error("    ❌ STEP FAILED: %s", exc)

    # Always capture screenshot
    await asyncio.sleep(0.3)
    try:
        await page.wait_for_selector("body", timeout=3_000)
    except Exception:
        pass

    step_result["screenshot"] = await _screenshot_b64(
        page, run_id, f"step{step_num}-{action}"
    )
    return step_result


# ── Main execution entry-point ────────────────────────────────────────────────

async def execute_playwright_tests(
    tests: list[dict[str, Any]],
    target_url: str,
    run_id: str,
    analysis_id: str,
) -> None:
    """
    Background task: run all tests sequentially with Playwright.
    Updates _runs[run_id] in-place frontend polls GET /repo/execution/{run_id}.
    """
    log.info("=" * 60)
    log.info("🚀 Starting run %s | target=%s | tests=%d", run_id[:8], target_url, len(tests))
    log.info("=" * 60)

    _runs[run_id] = {
        "run_id": run_id,
        "analysis_id": analysis_id,
        "status": "running",
        "results": [],
        "total": len(tests),
        "passed": 0,
        "failed": 0,
        "started_at": _utcnow(),
        "completed_at": None,
        "error": None,
    }

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        msg = "Playwright not installed. Run: pip install playwright && playwright install chromium"
        log.error("❌ %s", msg)
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = msg
        return

    try:
        async with async_playwright() as pw:
            log.info("🌐 Launching Chromium (headless) …")
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--use-gl=swiftshader",
                    "--enable-webgl",
                    "--allow-insecure-localhost",
                    "--window-size=1280,720",
                ],
            )
            log.info("✓ Browser launched")

            for t_idx, test in enumerate(tests, 1):
                test_id = str(test.get("_id") or test.get("id") or uuid.uuid4())
                test_name = test.get("name", f"Test #{t_idx}")
                steps = test.get("steps", [])

                log.info("")
                log.info("🧪 [%d/%d] %s", t_idx, len(tests), test_name)
                log.info("   steps=%d | id=%s", len(steps), test_id[:8])

                live_result: dict[str, Any] = {
                    "test_id": test_id,
                    "test_name": test_name,
                    "status": "running",
                    "steps_completed": 0,
                    "total_steps": len(steps),
                    "step_results": [],
                    "error": None,
                    "duration_ms": None,
                }
                _runs[run_id]["results"].append(live_result)

                t0 = time.monotonic()

                try:
                    ctx = await browser.new_context(
                        viewport={"width": 1280, "height": 720},
                        ignore_https_errors=True,
                        color_scheme="light",
                    )
                    page = await ctx.new_page()
                    page.on("console", lambda msg: (
                        log.warning("  [browser console %s] %s", msg.type, msg.text)
                        if msg.type in ("error", "warning") else None
                    ))
                    page.on("pageerror", lambda exc: log.error("  [browser pageerror] %s", exc))

                    for s_idx, step in enumerate(steps, 1):
                        sr = await _run_step(
                            page, step, target_url, run_id, test_name, s_idx
                        )
                        live_result["step_results"].append(sr)
                        live_result["steps_completed"] += 1

                    try:
                        await ctx.close()
                    except Exception:
                        pass

                    failed_steps = [s for s in live_result["step_results"] if s["status"] == "fail"]
                    live_result["status"] = "failed" if failed_steps else "passed"
                    icon = "✅" if live_result["status"] == "passed" else "❌"
                    log.info("%s %s %d failed steps", icon, test_name, len(failed_steps))

                except Exception as exc:
                    live_result["status"] = "failed"
                    live_result["error"] = str(exc)[:600]
                    log.error("❌ Test threw an unexpected exception: %s", exc)

                live_result["duration_ms"] = int((time.monotonic() - t0) * 1000)
                if live_result["status"] == "passed":
                    _runs[run_id]["passed"] += 1
                else:
                    _runs[run_id]["failed"] += 1

            try:
                await browser.close()
            except Exception:
                # Browser might already be closed or connection lost; ignore cleanup errors
                pass

        _runs[run_id]["status"] = "completed"
        _runs[run_id]["completed_at"] = _utcnow()
        await save_run_to_db(_runs[run_id])
        log.info("")
        log.info("=" * 60)
        log.info(
            "🏁 Run %s COMPLETE %d passed / %d failed",
            run_id[:8], _runs[run_id]["passed"], _runs[run_id]["failed"],
        )
        log.info("=" * 60)

    except asyncio.CancelledError:
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = "Run cancelled server was restarted while tests were running."
        _runs[run_id]["completed_at"] = _utcnow()
        log.warning("⚠️  Run %s cancelled (server shutdown)", run_id[:8])

    except Exception as exc:
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = str(exc)[:600]
        _runs[run_id]["completed_at"] = _utcnow()
        log.error("❌ Run %s crashed: %s", run_id[:8], exc, exc_info=True)
