/**
 * AIDLC design system single source of truth for token usage in TS/TSX.
 *
 * CSS layers (do not bypass):
 *   1. `styles/imcc-tokens.css`  refs + semantic (surface/text/action/feedback/status)
 *   2. `styles/imcc-bridge.css`  --color-* aliases, ink HSL, shadcn HSL, overlays
 *   3. Tailwind / `index.css`    utilities consumed by components
 *
 * Quick map
 * ┌────────────────────┬──────────────────────────────────────────────┐
 * │ Need               │ Use                                          │
 * ├────────────────────┼──────────────────────────────────────────────┤
 * │ Page background    │ bg-page / var(--color-page)                  │
 * │ Card / panel       │ bg-raised / Panel / page-card                │
 * │ Body text          │ text-ink or text-foreground                  │
 * │ Muted / helper     │ text-ink-secondary or text-muted-foreground  │
 * │ Quiet caption      │ text-ink-tertiary / text-ink-quaternary      │
 * │ Primary button     │ bg-primary text-primary-foreground           │
 * │ Secondary control  │ bg-secondary text-secondary-foreground       │
 * │ Status pill        │ StatusBadge tone=… (bg-status-*)             │
 * │ Inline success     │ text-feedback-success / text-success         │
 * └────────────────────┴──────────────────────────────────────────────┘
 *
 * Collision rule: shadcn `secondary` is a FILL. Prefer `text-ink-secondary`
 * for muted copy. Legacy `text-secondary` is remapped to ink via Tailwind plugin.
 */

import { BRAND_COLORS } from "./brand";

export {
  BRAND_COLORS,
  BRAND_NAME,
  BRAND_TAGLINE,
  FAVICON_SRC,
  LOGO_SRC,
  LOGO_LIGHT_SRC,
  LOGO_ICON_SRC,
  CHART_PALETTE,
  CHART_PALETTE_HSL,
} from "./brand";

/** Semantic roles for charts / imperative styles (theme-agnostic hex). */
export const DS_HEX = {
  primary: BRAND_COLORS.from,
  primaryLight: "#FFFFFF",
  positive: "#15803D",
  positiveLight: "#22C55E",
  destructive: "#DC2626",
  destructiveLight: "#F87171",
  warning: "#B45309",
  warningLight: "#F59E0B",
  info: "#2563EB",
  neutral: "#8A8A8A",
  neutralLight: "#AFAFAF",
  surface: "#101010",
  surfaceLight: "#F5F5F5",
  border: "#2A2A2A",
  borderLight: "#E5E5E5",
} as const;

/** Dark-default HSL channels (match imcc-bridge :root). Prefer CSS vars in UI. */
export const DS_HSL = {
  primary: "0 0% 98%",
  primaryForeground: "0 0% 0%",
  positive: "142 64% 30%",
  positiveForeground: "0 0% 100%",
  destructive: "0 72% 51%",
  destructiveForeground: "0 0% 100%",
  warning: "32 90% 37%",
  warningForeground: "0 0% 100%",
  info: "217 91% 53%",
  neutral: "0 0% 55%",
  neutralForeground: "0 0% 100%",
} as const;

export const DS_CHART = {
  series: [BRAND_COLORS.from, BRAND_COLORS.via2, BRAND_COLORS.to, BRAND_COLORS.via, BRAND_COLORS.deep],
  pass: DS_HEX.positive,
  passFill: "rgba(21, 128, 61, 0.25)",
  fail: DS_HEX.destructive,
  failFill: "rgba(220, 38, 38, 0.25)",
  warn: DS_HEX.warning,
  info: DS_HEX.info,
  neutral: DS_HEX.neutral,
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.45)",
  cursor: "rgba(255,255,255,0.06)",
  /** Light-theme chart chrome */
  gridLight: "rgba(0,0,0,0.08)",
  axisLight: "rgba(0,0,0,0.45)",
  cursorLight: "rgba(0,0,0,0.04)",
} as const;

export const DS = {
  success: DS_HEX.positive,
  warning: DS_HEX.warning,
  danger: DS_HEX.destructive,
  info: DS_HEX.info,
  neutral: DS_HEX.neutral,
} as const;

export const DS_RISK = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#B45309",
  low: "#15803D",
  none: "#6B7280",
} as const;

/** Badge / text class helpers for risk levels (use with DS_RISK hex fills). */
export const DS_RISK_BADGE: Record<keyof typeof DS_RISK, string> = {
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  none: "bg-muted text-muted-foreground border-border",
};

export const DS_PRIORITY = {
  p0: "#DC2626",
  p1: "#EA580C",
  p2: "#B45309",
  p3: "#2563EB",
  p4: "#6B7280",
} as const;

/** CSS custom properties to prefer in inline styles / charts */
export const DS_CSS = {
  page: "var(--color-page)",
  container: "var(--color-container)",
  raised: "var(--color-raised)",
  raised2: "var(--color-raised-2)",
  ink: "var(--color-primary)",
  inkSecondary: "var(--color-secondary)",
  inkTertiary: "var(--color-tertiary)",
  stroke: "var(--color-stroke)",
  strokeMuted: "var(--color-stroke-muted)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  info: "var(--color-info)",
} as const;
