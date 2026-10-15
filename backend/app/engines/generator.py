"""Generator engine streams LLM output token-by-token for a single file."""
import asyncio
import logging
import re
import threading
from typing import AsyncGenerator

from app.engines import kit
from app.services import ai_service

logger = logging.getLogger(__name__)

_TASK_NAME = "AI App Builder: Generate File"

_FILE_PROMPT = """\
You are an expert React 18 + TypeScript engineer generating a single production-quality file.

Project stack (ALL packages installed use freely):
- React 18 + TypeScript
- Tailwind CSS (all utilities available, including arbitrary values like bg-[#0f172a])
- react-router-dom v6 (link with <Link to="...">)
- framer-motion (motion.div, AnimatePresence, etc.)
- recharts (AreaChart, BarChart, PieChart, LineChart, etc.)
- lucide-react (any icon by name)
- clsx + tailwind-merge  (import {{ cn }} from '../lib/utils' OR import clsx from 'clsx')
- @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tabs, @radix-ui/react-tooltip
- @tanstack/react-query
- date-fns (format, formatDistanceToNow, etc.)

File to generate: {path}
Component name: {component_name}
Description: {description}
App name: {app_name}
Color theme / aesthetic: {color_theme}
Preferred imports: {imports}
App routes (path -> page): {routes}
Shared components in this app: {components}
{context_block}

STRICT OUTPUT RULES:
- Output ONLY the raw TypeScript/TSX file content. Absolutely NO markdown, NO backticks, NO explanations.
- First line must be an import statement.
- The default export must be: export default function {component_name}()
- Use Tailwind exclusively for all styling NO inline styles, NO CSS modules.
- Use Tailwind's named palette colours (e.g. bg-emerald-500, text-slate-300) rather than arbitrary hex values, and the `font-display` class on headings, so the app's design editor can restyle them.
- Create a STUNNING, production-grade UI. Think: dark glassmorphism, gradient accents, animated entries, clean typography.
- Include 20-50+ lines of realistic mock data (arrays/objects) defined inside the component or at module scope.
- Every interaction element (buttons, cards, tabs) must have hover/focus styles.
- Use framer-motion for smooth entrance animations (opacity 0→1, translateY).
- If using recharts: use real-looking data with 8-12 data points, styled with custom colors.
- Keep under 250 lines. No TODO comments. Fully functional, zero placeholder text.
- If this is a page, import the shared Navbar (import Navbar from '../components/Navbar') and render <Navbar /> as the first element. Do NOT use <Outlet>.
- If this is the Navbar, link to every app route above with <Link>/<NavLink> from react-router-dom, use sticky positioning and backdrop-blur, and accept no required props.
- Only import local files that exist: the shared components listed above (from '../components/<Name>') and '../lib/utils'. Never import a page from another page.
- Every default export is a component that takes no required props.
"""


def _role_rules(path: str, component_name: str, mark: str) -> str:
    """What this kind of file must contain: a page, a data module or a small component."""
    if path.startswith("src/pages/"):
        return (
            f"- This is a PAGE: `export default function {component_name}()` taking no props. Return\n"
            f"  <PageBody> starting with <PageHeader title=... description=... "
            f'mark={{<Mark id="{mark}" size={{44}} />}} />, then the content.'
        )
    if path.endswith(".ts"):
        return (
            "- This is a DATA module (.ts): export TypeScript types and typed constant arrays/objects of mock data,\n"
            "  plus small pure helper functions if useful. NO JSX, NO React imports, NO components, no default export."
        )
    return (
        f"- This is a shared COMPONENT: `export default function {component_name}(props)` with a typed props\n"
        "  interface; small and reusable. Do not render PageHeader/PageBody or any layout."
    )


# With the Chronos kit, a page composes ready-made components, so the model writes far
# less code per file (fewer output tokens, faster builds) and every app has the same look.
_KIT_FILE_PROMPT = """\
Write ONE file of a React 18 + TypeScript app (Vite, Tailwind v3, react-router-dom v6, recharts, lucide-react).

File: {path}
Purpose: {description}
App: {app_name}
Page icon (3D mark id): {mark}
Routes: {routes}
{context_block}
The app is wrapped in the Chronos kit's AppShell (sidebar + top bar), so a page renders ONLY its content.
Build the UI from the kit; do not re-create what it provides.

Chronos kit reference:
{kit_api}

3D icons available to <Mark id="..." />:
{marks}

RULES:
- Output only the file's code: no markdown fences, no explanations. Start with an import.
{role_rules}
- Import kit pieces from '../chronos' (or '../../chronos' from deeper folders). Import shared data only from
  files listed above, with their exact exported names.
- Style with the kit's semantic classes (bg-container, text-primary, border-muted, ...). No gradients,
  glassmorphism, drop shadows, framer-motion or custom colour palettes.
- Responsive by construction: rows of KpiTile go in <KpiGrid>, collections of cards/panels in <Grid>,
  two-up sections in <SplitRow>. Never a bare `grid-cols-N` without `sm:`/`lg:` prefixes, never fixed
  pixel widths on content. Keep KPI values short and pre-formatted (usdCompact for large money, 1 decimal
  for percentages); long text gets `truncate` or `line-clamp-2`.
- Keep it compact: at most ~140 lines; mock data of 5-12 realistic rows, defined at module scope.
- Interactions must work (search, filters, tabs with useState). No TODOs, no placeholder text.
"""

_FENCED_BLOCK = re.compile(r"```[a-zA-Z0-9_-]*[ \t]*\r?\n(.*?)\r?\n?```", re.DOTALL)


def strip_code_fences(text: str) -> str:
    """Return the code from model output that may be wrapped in a markdown fence.

    Handles a fence around the whole output, a fence preceded by a sentence
    ("Here is the file:"), and an unterminated opening fence. Output without a
    fence is returned unchanged apart from surrounding whitespace.
    """
    text = text.strip()
    if "```" not in text:
        return text
    match = _FENCED_BLOCK.search(text)
    if match:
        return match.group(1).strip()
    # Opening fence only: the model ran out of budget before closing it.
    text = re.sub(r"^.*?```[a-zA-Z0-9_-]*[ \t]*\r?\n", "", text, count=1, flags=re.DOTALL)
    return text.strip()


_strip_code_fences = strip_code_fences


def _schedule_usage_log(org_id: str | None, prompt_tokens: int, completion_tokens: int) -> None:
    """Fire-and-forget usage log through ai_service's cost logger."""

    async def _log() -> None:
        token = ai_service.set_current_org_id(org_id) if org_id else None
        try:
            await ai_service._log_cost(_TASK_NAME, prompt_tokens, completion_tokens)
        finally:
            if token is not None:
                ai_service.reset_current_org_id(token)

    try:
        asyncio.get_running_loop().create_task(_log())
    except RuntimeError:
        logger.warning("[Generator] No running loop; usage for a generation was not logged")


# Output budget for one generated file, including any reasoning the model does first.
_FILE_MAX_TOKENS = 8000

# Files already written for the same app are shown to later prompts so pages use
# shared components and data with the props and shapes they actually export.
_CONTEXT_FILE_CHARS = 5000
_CONTEXT_TOTAL_CHARS = 14000


def _context_block(context_files: dict) -> str:
    if not isinstance(context_files, dict) or not context_files:
        return ""
    parts: list[str] = []
    used = 0
    for path, content in context_files.items():
        if not isinstance(content, str) or not content.strip():
            continue
        body = content if len(content) <= _CONTEXT_FILE_CHARS else content[:_CONTEXT_FILE_CHARS] + "\n// ... truncated"
        if used + len(body) > _CONTEXT_TOTAL_CHARS:
            break
        used += len(body)
        parts.append(f"--- {path} ---\n{body}")
    if not parts:
        return ""
    return (
        "\nFiles already written for this app. Import them with the exact names, props and data shapes "
        "they export; do not redefine them:\n" + "\n\n".join(parts) + "\n"
    )


async def stream_file(file_spec: dict, org_id: str | None = None) -> AsyncGenerator[str, None]:
    """Yields tokens from Ollama for a single file spec.

    The model, key and base URL come from the same per-org connector config
    ai_service uses, and every call is written to api_cost_logs. `org_id`
    attributes the log entry when the caller runs outside request scope (the
    websocket handler); without it the request-scoped org is used.

    A provider error is raised to the caller once the tokens received before
    it have been yielded.
    """
    routes_text = ", ".join(
        f"{r.get('path')} -> {r.get('component')}" for r in file_spec.get("routes", []) if isinstance(r, dict)
    ) or "none planned"
    if kit.has_kit():
        prompt = _KIT_FILE_PROMPT.format(
            path=file_spec["path"],
            component_name=file_spec.get("component_name") or "Page",
            description=file_spec.get("description", ""),
            app_name=file_spec.get("app_name", "App"),
            mark=file_spec.get("mark") or "mark-command",
            role_rules=_role_rules(
                file_spec["path"], file_spec.get("component_name") or "Page", file_spec.get("mark") or "mark-command"
            ),
            routes=routes_text,
            context_block=_context_block(file_spec.get("context_files") or {}),
            kit_api=kit.kit_api() or "(see src/chronos/index.ts)",
            # The planned icon plus the icons closest to this page's purpose.
            marks=kit.marks_catalog(
                " ".join(str(file_spec.get(k) or "") for k in ("mark", "description", "component_name", "app_name")), 30
            ) or "(none)",
        )
    else:
        prompt = _legacy_prompt(file_spec, routes_text)
    async for token in _stream_prompt(prompt, file_spec, org_id):
        yield token


def _legacy_prompt(file_spec: dict, routes_text: str) -> str:
    return _FILE_PROMPT.format(
        path=file_spec["path"],
        component_name=file_spec.get("component_name", "Component"),
        description=file_spec.get("description", ""),
        app_name=file_spec.get("app_name", "AI App"),
        color_theme=file_spec.get("color_theme", "dark luxury with gradient accents"),
        imports=", ".join(file_spec.get("imports", [])),
        routes=routes_text,
        components=", ".join(file_spec.get("components", [])) or "none",
        context_block=_context_block(file_spec.get("context_files") or {}),
    )


async def _stream_prompt(prompt: str, file_spec: dict, org_id: str | None) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    error_holder: list[Exception] = []
    # [prompt_tokens, completion_tokens]; stays zero if the provider reports no usage.
    usage_holder: list[int] = [0, 0]

    # Resolved here, not in the worker thread: connector config is context-local.
    client = ai_service._get_client()
    _, _, model = ai_service._ollama_cfg()

    def _sync_stream() -> None:
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an elite React/TypeScript UI engineer. "
                            "Output raw TypeScript/TSX code ONLY. "
                            "Absolutely no markdown fences, no backticks, no explanations, no comments about what you are doing. "
                            "Start directly with the import statement."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                stream=True,
                stream_options={"include_usage": True},
                # Thinking models (kimi-k3, gpt-oss) count their reasoning against
                # max_tokens. Without a low reasoning effort and enough room they
                # spend the whole budget thinking and stream no code at all.
                max_tokens=_FILE_MAX_TOKENS,
                temperature=0.3,
                extra_body={"reasoning_effort": "low"},
            )
            for chunk in stream:
                usage = getattr(chunk, "usage", None)
                if usage:
                    usage_holder[0] = usage.prompt_tokens or 0
                    usage_holder[1] = usage.completion_tokens or 0
                if chunk.choices and chunk.choices[0].delta.content:
                    loop.call_soon_threadsafe(
                        queue.put_nowait, chunk.choices[0].delta.content
                    )
        except Exception as exc:
            logger.error(f"[Generator] Stream error for {file_spec.get('path')}: {exc}")
            error_holder.append(exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    t = threading.Thread(target=_sync_stream, daemon=True)
    t.start()

    try:
        while True:
            token = await queue.get()
            if token is None:
                break
            yield token
        if error_holder:
            raise error_holder[0]
    finally:
        # Runs on completion, error and cancellation (caller timeout), so every
        # call is logged; tokens are zero when usage never arrived.
        _schedule_usage_log(org_id, usage_holder[0], usage_holder[1])
