"""Planner engine asks the LLM to decide what files to generate."""
import json
import re

from app.services.ai_service import _call_openai, _clean_json  # reuse existing sync wrapper

_PLANNER_PROMPT = """\
You are a senior React architect. Given a user idea, produce a comprehensive JSON build plan \
for a production-quality, visually stunning web application.

The generated project uses this exact stack (all packages are already in package.json):
- React 18 + TypeScript + Vite
- Tailwind CSS (full utility set, dark mode via class strategy)
- react-router-dom v6 (BrowserRouter already set up in App.tsx)
- framer-motion for animations and transitions
- recharts for data visualization (charts, graphs)
- lucide-react for icons
- clsx + tailwind-merge for conditional classes
- @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tabs, @radix-ui/react-tooltip (Radix UI primitives already installed)
- @tanstack/react-query for server state / data fetching
- date-fns for date formatting

Template already provides:
  src/App.tsx          (BrowserRouter with AUTO_IMPORTS and AUTO_ROUTES markers)
  src/main.tsx
  src/index.css        (Tailwind directives)
  package.json         (all deps above pre-installed)

User idea: {idea}

Return ONLY valid JSON no markdown, no backticks:
{{
  "app_name": "Human readable title for this app",
  "description": "One sentence describing the app",
  "color_theme": "dark luxury / vibrant gradient / minimal clean / etc.",
  "files": [
    {{
      "path": "src/pages/Dashboard.tsx",
      "component_name": "Dashboard",
      "description": "Main dashboard with KPI cards, a recharts line chart, and recent activity list. Dark glassmorphism style. Rich with real mock data.",
      "imports": ["recharts", "framer-motion", "lucide-react"],
      "priority": 1
    }},
    {{
      "path": "src/components/Navbar.tsx",
      "component_name": "Navbar",
      "description": "Sticky top navigation bar with logo, nav links, and a CTA button. Glassmorphism backdrop blur.",
      "imports": ["framer-motion", "lucide-react"],
      "priority": 0
    }}
  ],
  "routes": [
    {{
      "path": "/",
      "component": "Dashboard",
      "importPath": "./pages/Dashboard"
    }}
  ]
}}

RULES:
- Generate 3–6 page files (src/pages/*.tsx) that together form a complete, usable app
- You may add 2-3 shared components (src/components/*.tsx) do NOT add routes for components
- Pages must be richly detailed with realistic mock data arrays/objects defined inside
- Sort files by priority: shared components first (priority 0), then pages (priority 1+)
- component_name must exactly match the file's TypeScript default export name
- Only use packages listed above
- Each file must be self-contained with all imports at the top
- The app must have a visually stunning, modern aesthetic matching color_theme
- Include a navigation component that links between all pages
"""


async def plan_files(idea: str) -> dict:
    prompt = _PLANNER_PROMPT.format(idea=idea)
    raw = await _call_openai(prompt, json_mode=True, task_name="AI IDE – Plan Files")
    text = _clean_json(raw)
    plan = json.loads(text)
    # Sort files so components (priority 0) are generated before pages
    if "files" in plan and isinstance(plan["files"], list):
        plan["files"].sort(key=lambda f: f.get("priority", 1))
    return plan
