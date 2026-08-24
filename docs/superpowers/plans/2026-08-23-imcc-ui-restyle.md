# IMCC UI Restyle Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle AIDLC frontend to IMCC dark visual system end-to-end.

**Architecture:** Port IMCC tokens, bridge shadcn CSS vars, rebuild shell + shared primitives, sweep pages, delete junk.

**Tech Stack:** React 18, Vite, Tailwind v3, shadcn/ui, IMCC tokens

**Spec:** `docs/superpowers/specs/2026-08-23-imcc-ui-restyle-design.md`

## Global Constraints

- Dark mode default; keep AIDLC routes/features
- No Next.js migration; no backend changes
- Prefer IMCC semantic tokens over Wayam orange

---

### Task 1: Tokens + Tailwind + fonts

- [ ] Import `imcc-tokens.css`; rewrite `index.css` dark bridge for shadcn
- [ ] Extend `tailwind.config.ts` with page/container/raised/text/status colors + Geist/Michroma
- [ ] Load fonts in `index.html`
- [ ] Verify app builds / loads dark

### Task 2: Shell + Login

- [ ] Rebuild `DashboardLayout` (topbar + sidebar + main)
- [ ] Restyle `AppSidebar`
- [ ] Dark Login panel (IMCC surfaces)
- [ ] Delete obvious junk copies

### Task 3: Shared primitives

- [ ] Update `PageHeader`, `PageShell`, add `StatusBadge`, `KpiStat`, `Panel`

### Task 4: Page sweep

- [ ] Dashboard + beta workflow pages
- [ ] Platform tool pages (workspace, pipeline, etc.)
- [ ] Retint chart/brand helpers away from orange glow

### Task 5: Cleanup verify

- [ ] Remove unused Landing/Index/App.css/copies
- [ ] Smoke routes visually
