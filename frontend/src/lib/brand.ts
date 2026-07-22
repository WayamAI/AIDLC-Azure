export const BRAND_NAME = "AIDLC";
export const BRAND_TAGLINE = "AI-Powered SDLC Platform";
export const LOGO_SRC = "/logo.png";
export const LOGO_ICON_SRC = "/logo-icon.png";
export const FAVICON_SRC = "/favicon.png";

/** Brand gradient stops (from AIDLC logo orange accent) */
export const BRAND_COLORS = {
  from: "#FFA12B",
  via: "#FA8D23",
  via2: "#F0731A",
  to: "#DC440C",
  deep: "#D13608",
  ink: "#161C26",
} as const;

/** Chart & data-viz palette derived from AIDLC brand */
export const CHART_PALETTE = [
  BRAND_COLORS.from,
  BRAND_COLORS.via2,
  BRAND_COLORS.to,
  BRAND_COLORS.via,
  BRAND_COLORS.deep,
] as const;

export const CHART_PALETTE_HSL = [
  "hsl(32, 100%, 58%)",
  "hsl(25, 88%, 52%)",
  "hsl(18, 90%, 45%)",
  "hsl(28, 95%, 55%)",
  "hsl(32, 82%, 42%)",
] as const;
