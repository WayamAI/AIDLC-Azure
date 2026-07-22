"""Generator engine streams LLM output token-by-token for a single file."""
import asyncio
import logging
import re
import threading
from typing import AsyncGenerator

from openai import OpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_client = OpenAI(
    base_url=f"{settings.OLLAMA_BASE_URL.rstrip('/')}/v1",
    api_key=settings.OLLAMA_API_KEY or "ollama",
)

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

STRICT OUTPUT RULES:
- Output ONLY the raw TypeScript/TSX file content. Absolutely NO markdown, NO backticks, NO explanations.
- First line must be an import statement.
- The default export must be: export default function {component_name}()
- Use Tailwind exclusively for all styling NO inline styles, NO CSS modules.
- Create a STUNNING, production-grade UI. Think: dark glassmorphism, gradient accents, animated entries, clean typography.
- Include 20-50+ lines of realistic mock data (arrays/objects) defined inside the component or at module scope.
- Every interaction element (buttons, cards, tabs) must have hover/focus styles.
- Use framer-motion for smooth entrance animations (opacity 0→1, translateY).
- If using recharts: use real-looking data with 8-12 data points, styled with custom colors.
- Keep under 250 lines. No TODO comments. Fully functional, zero placeholder text.
- If this is a page, render a Navbar or import the shared Navbar component.
- If this is a Navbar/layout component, use sticky positioning and backdrop-blur.
"""


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences that the model sometimes outputs despite instructions."""
    text = text.strip()
    # Remove opening fence: ```tsx, ```typescript, ```ts, ```jsx, ```
    text = re.sub(r'^```[a-zA-Z]*\s*\n?', '', text)
    # Remove closing fence
    text = re.sub(r'\n?```\s*$', '', text)
    return text.strip()


async def stream_file(file_spec: dict) -> AsyncGenerator[str, None]:
    """Yields tokens from Ollama for a single file spec."""
    prompt = _FILE_PROMPT.format(
        path=file_spec["path"],
        component_name=file_spec.get("component_name", "Component"),
        description=file_spec.get("description", ""),
        app_name=file_spec.get("app_name", "AI App"),
        color_theme=file_spec.get("color_theme", "dark luxury with gradient accents"),
        imports=", ".join(file_spec.get("imports", [])),
    )

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    error_holder: list[Exception] = []

    def _sync_stream() -> None:
        try:
            stream = _client.chat.completions.create(
                model=settings.OLLAMA_MODEL,
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
                max_tokens=3000,
                temperature=0.3,
            )
            for chunk in stream:
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

    collected: list[str] = []
    while True:
        token = await queue.get()
        if token is None:
            break
        collected.append(token)
        yield token

    # Post-process: if the full output has code fences, strip them and re-yield a corrected sentinel
    # Note: caller (ws handler) accumulates tokens independently; stripping here is informational
    if collected:
        full = "".join(collected)
        stripped = _strip_code_fences(full)
        if stripped != full:
            logger.warning(f"[Generator] Stripped code fences from {file_spec.get('path')}")
