"""Planner engine asks the LLM to decide what files to generate."""
from app.engines import kit
from app.services.ai_service import _call_openai, _parse_json_object  # reuse existing sync wrapper

_KIT_PLANNER_PROMPT = """\
You are a senior React architect planning a web app. Reply with a JSON build plan only.

The project is React 18 + TypeScript + Vite + Tailwind v3 + react-router-dom v6, and it already contains
the Chronos UI kit in src/chronos: an AppShell (sidebar navigation + top bar, built automatically from
your routes), PageHeader, KpiGrid + KpiTile, Grid, SplitRow, Panel, ChartCard, DataTable, BarList,
StatusBadge, EmptyState, Select, InfoPopover, Mark (decorative 3D icons), number/date formatters, and
charts: LineChart, AreaChart, BarChart (stacked/horizontal), ComboChart, DonutChart (centre total),
Sparkline, Gauge, ProgressRing, ProgressBars, FunnelChart, BulletChart. Pick the chart that fits the
question (trend -> Line/Area, comparison -> Bar, share of total -> Donut, conversion -> Funnel, target ->
Bullet/Gauge, trend inside a KPI -> Sparkline). The visual style is fixed
(Chronos: light, clean, bordered panels), so do NOT plan layout, navigation, theme or generic UI files.

User idea: {idea}

Return ONLY valid JSON, no markdown:
{{
  "app_name": "Plain name of what it is, e.g. Clinic Appointments",
  "description": "One sentence describing the app",
  "files": [
    {{"path": "src/data/store.ts", "component_name": "", "description": "Typed mock data shared by pages: ...", "priority": 0}},
    {{"path": "src/pages/Overview.tsx", "component_name": "Overview", "description": "What this page shows and which kit components it uses", "mark": "mark-command", "priority": 1}}
  ],
  "routes": [
    {{"path": "/", "component": "Overview", "importPath": "./pages/Overview", "label": "Overview", "icon": "LayoutDashboard"}}
  ]
}}

RULES:
- Naming: "app_name" is 1-3 plain words that say what the app is for, in the client's language
  ("Clinic Appointments", "Resort Operations", "Budget Tracker"). No invented brand names, no
  "AI"/"Smart"/"Pro"/"Hub"/"ly"/"ify" coinages, no slogans. Page labels are plain nouns
  ("Overview", "Bookings", "Guests"), never "Insights Hub" or "Command Center".
- 3-5 pages in src/pages/*.tsx, each a route. Exactly one route has path "/".
- At most ONE shared data file (src/data/*.ts, priority 0) with typed mock data used by several pages.
  Only add a custom component (src/components/*.tsx, priority 0) for something the kit truly lacks.
- Never plan a Navbar, Sidebar, Layout or App file.
- "icon" is a lucide-react icon name in PascalCase (e.g. LayoutDashboard, Users, Settings, BarChart3).
- "mark" is one id from the 3D icon list below that fits the page.
- Each page "description" is a BLUEPRINT, top to bottom, e.g. "KpiGrid: 4 KpiTiles (Revenue usdCompact,
  Occupancy %, ADR, Cancellations) | SplitRow: Chart area of daily revenue (30 days) + BarList top 5 room
  types | DataTable of recent bookings (guest, dates, status badge, total) with search". Name the kit
  component for every section and the exact data it shows. Vary the layout between pages.
- The shared data file must define every dataset the pages' blueprints mention (typed, realistic,
  internally consistent numbers), so pages only import and display it.

3D icons:
{marks}
"""

_LEGACY_PLANNER_PROMPT = """\
You are a senior React architect. Given a user idea, produce a JSON build plan for a web application
built with React 18 + TypeScript + Vite + Tailwind CSS + react-router-dom v6 + recharts + lucide-react.

User idea: {idea}

Return ONLY valid JSON, no markdown:
{{
  "app_name": "Human readable title",
  "description": "One sentence",
  "color_theme": "the visual direction",
  "files": [
    {{"path": "src/components/Navbar.tsx", "component_name": "Navbar", "description": "...", "imports": ["lucide-react"], "priority": 0}},
    {{"path": "src/pages/Dashboard.tsx", "component_name": "Dashboard", "description": "...", "imports": ["recharts"], "priority": 1}}
  ],
  "routes": [{{"path": "/", "component": "Dashboard", "importPath": "./pages/Dashboard", "label": "Dashboard", "icon": "LayoutDashboard"}}]
}}

RULES:
- 3-5 page files (src/pages/*.tsx) and src/components/Navbar.tsx (priority 0) linking every route; pages render <Navbar /> first.
- Exactly one route has path "/". component_name equals the default export name.
"""


async def plan_files(idea: str) -> dict:
    if kit.has_kit():
        prompt = _KIT_PLANNER_PROMPT.format(idea=idea, marks=kit.marks_catalog(idea, 60) or "(none available)")
    else:
        prompt = _LEGACY_PLANNER_PROMPT.format(idea=idea)
    raw = await _call_openai(prompt, json_mode=True, task_name="AI IDE – Plan Files")
    plan = _parse_json_object(raw)
    files = plan.get("files")
    if isinstance(files, list):
        if kit.has_kit():
            # The kit's AppShell is the navigation; a planned Navbar/Layout would duplicate it.
            files = [
                f for f in files
                if isinstance(f, dict)
                and str(f.get("path", "")).rsplit("/", 1)[-1].split(".")[0].lower()
                not in {"navbar", "sidebar", "layout", "app", "header", "nav"}
            ]
        files.sort(key=lambda f: f.get("priority", 1) if isinstance(f, dict) else 1)
        plan["files"] = files
    return plan
