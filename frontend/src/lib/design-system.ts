/**
 * Wayam Design System single source of truth for colors & semantics.
 *
 * Palette is warm-only: orange brand gradient + amber positive + red destructive.
 * Do NOT use green/emerald in UI use `positive` for pass/success/complete states.
 */
import { BRAND_COLORS } from "./brand";

export { BRAND_COLORS, BRAND_NAME, BRAND_TAGLINE, FAVICON_SRC, LOGO_SRC, LOGO_ICON_SRC } from "./brand";

/** Core semantic hues (HSL components for CSS vars) */
export const DS_HSL = {
  primary: "25 88% 52%",
  primaryForeground: "0 0% 100%",
  positive: "32 82% 42%",
  positiveForeground: "0 0% 100%",
  destructive: "8 85% 44%",
  destructiveForeground: "0 0% 100%",
  warning: "36 90% 40%",
  warningForeground: "36 90% 12%",
  neutral: "25 10% 42%",
  neutralForeground: "0 0% 100%",
} as const;

/** Hex values for charts, SVGs, and inline styles */
export const DS_HEX = {
  primary: BRAND_COLORS.via2,
  primaryLight: BRAND_COLORS.from,
  positive: "#C27803",
  positiveLight: "#FFA12B",
  destructive: BRAND_COLORS.to,
  destructiveLight: "#F87171",
  warning: "#D97706",
  warningLight: "#FBBF24",
  neutral: "#78716C",
  neutralLight: "#A8A29E",
  surface: "#FFFBF7",
  border: "#E8DDD4",
} as const;

/** Chart series warm palette only */
export const DS_CHART = {
  series: [
    BRAND_COLORS.from,
    BRAND_COLORS.via2,
    BRAND_COLORS.to,
    BRAND_COLORS.via,
    BRAND_COLORS.deep,
  ],
  pass: BRAND_COLORS.from,
  fail: BRAND_COLORS.to,
  warn: DS_HEX.warning,
  neutral: DS_HEX.neutral,
  passFill: "rgba(255, 161, 43, 0.15)",
  failFill: "rgba(220, 68, 12, 0.12)",
} as const;

/** Tailwind class bundles for semantic UI states */
export const DS = {
  primary: {
    text: "text-primary",
    icon: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/25",
    badge: "text-primary border-primary/25 bg-primary/10",
    solid: "bg-primary text-primary-foreground",
  },
  positive: {
    text: "text-positive",
    icon: "text-positive",
    bg: "bg-positive/10",
    border: "border-positive/25",
    badge: "text-positive border-positive/25 bg-positive/10",
    solid: "bg-positive text-positive-foreground",
  },
  destructive: {
    text: "text-destructive",
    icon: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/25",
    badge: "text-destructive border-destructive/25 bg-destructive/10",
    solid: "bg-destructive text-destructive-foreground",
  },
  warning: {
    text: "text-warning",
    icon: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/25",
    badge: "text-warning border-warning/25 bg-warning/10",
    solid: "bg-warning text-warning-foreground",
  },
  neutral: {
    text: "text-muted-foreground",
    icon: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    badge: "text-muted-foreground border-border bg-muted",
  },
} as const;

/** Risk / priority warm scale only */
export const DS_RISK = {
  critical: DS.destructive,
  high: {
    text: "text-destructive",
    icon: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/25",
    badge: "text-destructive border-destructive/25 bg-destructive/10",
  },
  medium: DS.warning,
  low: DS.positive,
} as const;

export const DS_PRIORITY = {
  Critical: DS.destructive.text,
  High: "text-primary",
  Medium: DS.warning.text,
  Low: DS.neutral.text,
} as const;

/** @deprecated Use DS.positive kept for gradual migration */
export const STATUS = {
  success: DS.positive,
  danger: DS.destructive,
  warning: DS.warning,
  info: DS.neutral,
  primary: DS.primary,
} as const;

export const RISK = {
  critical: DS_RISK.critical,
  high: DS_RISK.high,
  medium: DS_RISK.medium,
  low: DS_RISK.low,
} as const;

export const PRIORITY = DS_PRIORITY;
