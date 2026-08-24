export const BRAND_NAME = "AIDLC";
export const BRAND_TAGLINE = "SDLC Platform";

/** Full wordmark for dark UI (white letterforms). From AIDLC Assets. */
export const LOGO_SRC = "/logo.svg";
/** Full wordmark for light UI (dark letterforms). From AIDLC Assets. */
export const LOGO_LIGHT_SRC = "/logo-light.svg";
/** Compact mark / favicon. From AIDLC Assets. */
export const LOGO_ICON_SRC = "/logo-icon.png";
export const FAVICON_SRC = "/favicon.png";

/** Wayam mark oranges (logo SVG) + neutral ramp for charts/UI */
export const WAYAM_ORANGE = {
  bright: "#FC7F06",
  amber: "#FDA40B",
  ember: "#DF4302",
} as const;

/** Neutral accent ramp (IMCC-aligned); login ambient uses WAYAM_ORANGE */
export const BRAND_COLORS = {
  from: "#F2F2F2",
  via: "#E5E5E5",
  via2: "#D4D4D4",
  to: "#AFAFAF",
  deep: "#8A8A8A",
  ink: "#101010",
  orange: WAYAM_ORANGE.bright,
  amber: WAYAM_ORANGE.amber,
  ember: WAYAM_ORANGE.ember,
} as const;

/** Chart palette: neutrals + IMCC status hues */
export const CHART_PALETTE = [
  "#AFAFAF",
  "#2563EB",
  "#15803D",
  "#B45309",
  "#DC2626",
] as const;

export const CHART_PALETTE_HSL = [
  "hsl(0, 0%, 69%)",
  "hsl(217, 91%, 53%)",
  "hsl(142, 64%, 30%)",
  "hsl(32, 90%, 37%)",
  "hsl(0, 72%, 51%)",
] as const;
