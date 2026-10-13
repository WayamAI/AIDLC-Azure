# AIDLC ← IMCC UI Restyle (Option B)

**Status:** Approved for implementation  
**Date:** 2026-08-23

## Goal

Restyle AIDLC’s frontend to match IMCC’s dark-first visual system (tokens, typography, shell, page chrome) while keeping AIDLC routes, features, and API wiring.

## Non-goals

- WorkOS auth, backend, multi-tenancy
- Migrating to Next.js
- Copying IMCC mining/map screens
- Self-healing feature work

## Design

### Visual system

- Port IMCC `styles/tokens.css` into `frontend/src/styles/imcc-tokens.css`
- Dark mode default
- Fonts: Geist (UI) + Michroma (display headings / KPI figures)
- Bridge shadcn HSL vars (`--background`, `--primary`, …) onto IMCC dark surfaces so existing UI primitives keep working
- Expose IMCC utilities in Tailwind: `bg-page`, `bg-container`, `bg-raised`, `text-primary/secondary/tertiary/quaternary`, `border-default`, status colors

### Shell

- Topbar: logo mark, breadcrumbs, search affordance, profile/logout
- Sidebar: existing AIDLC nav groups, restyled to IMCC rail (dark, muted labels, raised active state)
- Main: `bg-page`; padded pages vs full-bleed for workspace / AI IDE / pipeline / graphs
- Optional slim footer

### Shared primitives

- `PageHeader` Michroma title, description, actions
- `PageShell` / `Panel` raised container surfaces
- `StatusBadge` critical | warning | success | info | pending | neutral
- `KpiStat` large figure + quiet label

### Page pass

Every routed page: replace orange/glow/card-heavy chrome with IMCC surfaces; retint charts to neutrals + status colors; keep hooks/API logic.

### Cleanup

Delete: `GephiSigmaGraph copy.tsx`, `GephiSigmaGraph copy 2.tsx`, unused `Landing.tsx` / `Index.tsx` if unrouted, dead `App.css` if unused, orange-glow utilities that fight the new system.
