/**
 * Theme engine for the Chronos UI kit.
 *
 * Pure TypeScript: no React, no DOM. Turns editor settings into a CSS override
 * file (`src/design.css`) that loads after `tokens.css` and overrides the
 * semantic variables it defines. Kit defaults below are copied from
 * `backend/app/templates/chronos_kit/src/chronos/tokens.css`.
 */

export type SurfaceStyle = "neutral" | "warm" | "cool" | "tinted";

export type StatusColors = { success: string; info: string; warning: string; error: string };

export type ThemeSettings = {
  mode: "light" | "dark";
  accent: string | null;
  surface: SurfaceStyle;
  status: StatusColors | null;
  chart: string[] | null;
};

export type ThemePreview = {
  page: string;
  container: string;
  raised: string;
  text: string;
  textMuted: string;
  stroke: string;
  accent: string;
  accentContent: string;
  series: string[];
  success: string;
  error: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  description: string;
  theme: ThemeSettings;
  fonts: { sans: string; display: string };
  radius: number;
};

export const DEFAULT_THEME: ThemeSettings = {
  mode: "light",
  accent: null,
  surface: "neutral",
  status: null,
  chart: null,
};

/* -----------------------------------------------------------------------
   Kit defaults (tokens.css)
   ----------------------------------------------------------------------- */

const KIT_ORANGE = "#ff7b1c";
const SURFACE_ORDER: SurfaceStyle[] = ["neutral", "warm", "cool", "tinted"];
const STATUS_KEYS: (keyof StatusColors)[] = ["success", "info", "warning", "error"];

type Mode = "light" | "dark";

type SurfaceColors = { page: string; container: string; raised: string; raisedX2: string };

const KIT: Record<
  Mode,
  SurfaceColors & {
    text: string;
    textMuted: string;
    stroke: string;
    accent: string;
    accentContent: string;
    series: string[];
    success: string;
    error: string;
  }
> = {
  light: {
    page: "#f2f2f2",
    container: "#ffffff",
    raised: "#fafafa",
    raisedX2: "#f2f2f2",
    text: "#101010",
    textMuted: "#464646",
    stroke: "rgba(0, 0, 0, 0.14)",
    accent: "#101010",
    accentContent: "#ffffff",
    series: ["#2179be", "#318c54", "#e95d0f", "#e9343c", "#626262", "#862aa3"],
    success: "#318c54",
    error: "#e9343c",
  },
  dark: {
    page: "#000000",
    container: "#101010",
    raised: "#191919",
    raisedX2: "#232323",
    text: "#fafafa",
    textMuted: "#d4d4d4",
    stroke: "rgba(255, 255, 255, 0.14)",
    accent: "#fafafa",
    accentContent: "#000000",
    series: ["#55b4eb", "#62c487", "#ff963d", "#ff646b", "#afafaf", "#b65bd8"],
    success: "#62c487",
    error: "#ff646b",
  },
};

/* -----------------------------------------------------------------------
   Colour maths
   ----------------------------------------------------------------------- */

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!HEX_RE.test(v)) return null;
  let body = v.slice(1).toLowerCase();
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  return "#" + body;
}

function parseHex(hex: string): RGB {
  const n = normalizeHex(hex);
  if (n === null) throw new TypeError(`Invalid hex colour: ${String(hex)}`);
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toHex({ r, g, b }: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = ln - c / 2;
  return toHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 });
}

function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** WCAG 2.1 contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of white or near-black has the higher contrast against `hex`. */
export function readableOn(hex: string): string {
  const white = "#ffffff";
  const black = "#101010";
  return contrastRatio(hex, white) >= contrastRatio(hex, black) ? white : black;
}

/**
 * Lightness mix in HSL. Negative darkens toward black, positive lightens
 * toward white. Amount is clamped to -1..1.
 */
export function shade(hex: string, amount: number): string {
  const a = Number.isFinite(amount) ? clamp(amount, -1, 1) : 0;
  const { h, s, l } = rgbToHsl(parseHex(hex));
  const nextL = a < 0 ? l * (1 + a) : l + (100 - l) * a;
  return hslToHex(h, s, nextL);
}

/* -----------------------------------------------------------------------
   Normalisation
   ----------------------------------------------------------------------- */

/** Tolerant: anything invalid falls back to the kit default for that field. */
export function normalizeTheme(input: unknown): ThemeSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ...DEFAULT_THEME };
  }
  const o = input as Record<string, unknown>;

  const mode: Mode = o.mode === "dark" ? "dark" : "light";
  const accent = normalizeHex(o.accent);
  const surface: SurfaceStyle = SURFACE_ORDER.includes(o.surface as SurfaceStyle)
    ? (o.surface as SurfaceStyle)
    : "neutral";

  let status: StatusColors | null = null;
  if (typeof o.status === "object" && o.status !== null && !Array.isArray(o.status)) {
    const s = o.status as Record<string, unknown>;
    const parsed = {} as StatusColors;
    let ok = true;
    for (const key of STATUS_KEYS) {
      const hex = normalizeHex(s[key]);
      if (hex === null) {
        ok = false;
        break;
      }
      parsed[key] = hex;
    }
    if (ok) status = parsed;
  }

  let chart: string[] | null = null;
  if (Array.isArray(o.chart) && o.chart.length === 6) {
    const colours = o.chart.map((c) => normalizeHex(c));
    if (colours.every((c) => c !== null)) chart = colours as string[];
  }

  return { mode, accent, surface, status, chart };
}

/* -----------------------------------------------------------------------
   Resolution helpers (shared by themeCss and themePreview)
   ----------------------------------------------------------------------- */

function surfaceColors(theme: ThemeSettings, mode: Mode): SurfaceColors {
  const dark = mode === "dark";
  switch (theme.surface) {
    case "warm":
      return dark
        ? { page: "#0b0a08", container: "#15130f", raised: "#1d1a16", raisedX2: "#26231e" }
        : { page: "#f4f2ee", container: "#fffdfa", raised: "#faf8f5", raisedX2: "#f1eee9" };
    case "cool":
      return dark
        ? { page: "#05080c", container: "#0d131b", raised: "#141b25", raisedX2: "#1c2531" }
        : { page: "#eef2f7", container: "#ffffff", raised: "#f6f8fb", raisedX2: "#e9eef5" };
    case "tinted": {
      const h = rgbToHsl(parseHex(theme.accent ?? KIT_ORANGE)).h;
      return dark
        ? {
            page: hslToHex(h, 25, 4),
            container: hslToHex(h, 20, 8),
            raised: hslToHex(h, 18, 11),
            raisedX2: hslToHex(h, 16, 15),
          }
        : {
            page: hslToHex(h, 30, 96),
            container: hslToHex(h, 40, 99.5),
            raised: hslToHex(h, 30, 97.5),
            raisedX2: hslToHex(h, 25, 94),
          };
    }
    default:
      return { ...KIT[mode] };
  }
}

/** Default (non-hover) action colour for the accent in a given mode. */
function resolveAccent(theme: ThemeSettings, mode: Mode): string {
  const accent = theme.accent as string;
  if (mode === "light") return accent;
  const darkContainer = surfaceColors(theme, "dark").container;
  return contrastRatio(accent, darkContainer) < 3 ? shade(accent, 0.1) : accent;
}

/** Six series: explicit chart wins, otherwise derived from the accent, otherwise null (kit). */
function resolveSeries(theme: ThemeSettings): string[] | null {
  if (theme.chart) return theme.chart;
  if (theme.accent) return derivedSeries(theme.accent);
  return null;
}

function derivedSeries(accent: string): string[] {
  const { h, s, l } = rgbToHsl(parseHex(accent));
  const sat = clamp(s, 45, 75);
  const lig = clamp(l, 45, 55);
  return [accent, ...[60, 140, 200, 260, 320].map((d) => hslToHex(h + d, sat, lig))];
}

/* -----------------------------------------------------------------------
   CSS output
   ----------------------------------------------------------------------- */

const CSS_HEADER =
  "/* Generated by the Chakram design editor. Edit the theme in the App Builder's Design tab. */";

type Decl = [string, string];

function declarations(theme: ThemeSettings, mode: Mode): Decl[] {
  const out: Decl[] = [];
  const dark = mode === "dark";

  if (theme.surface !== "neutral") {
    const s = surfaceColors(theme, mode);
    out.push(
      ["--surface-page-background", s.page],
      ["--surface-container", s.container],
      ["--surface-raised", s.raised],
      ["--surface-raised-x2", s.raisedX2],
    );
  }

  if (theme.accent) {
    const def = resolveAccent(theme, mode);
    out.push(
      ["--action-primary-default", def],
      ["--action-primary-hover", shade(def, dark ? 0.08 : -0.08)],
      ["--action-primary-focused", shade(def, dark ? 0.14 : -0.14)],
      ["--action-primary-content", readableOn(def)],
      ["--stroke-active", def],
      ["--surface-action", def],
    );
  }

  const series = resolveSeries(theme);
  if (series) {
    series.forEach((c, i) => out.push([`--analytics-series-${i + 1}`, c]));
  }

  if (theme.status) {
    for (const key of STATUS_KEYS) {
      const c = theme.status[key];
      const p = `--feedback-${key}`;
      if (dark) {
        out.push(
          [`${p}-icon`, shade(c, 0.1)],
          [`${p}-content`, shade(c, 0.3)],
          [`${p}-badge`, shade(c, -0.05)],
          [`${p}-background`, rgba(c, 0.16)],
          [`${p}-stroke`, rgba(c, 0.4)],
        );
      } else {
        out.push(
          [`${p}-icon`, c],
          [`${p}-content`, shade(c, -0.25)],
          [`${p}-badge`, shade(c, -0.15)],
          [`${p}-background`, rgba(c, 0.12)],
          [`${p}-stroke`, rgba(c, 0.35)],
        );
      }
    }
  }

  return out;
}

function block(selector: string, decls: Decl[]): string {
  return `${selector} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
}

/** CSS override for `src/design.css`. Empty string when the theme matches the kit. */
export function themeCss(theme: ThemeSettings): string {
  const t = normalizeTheme(theme);
  const light = declarations(t, "light");
  const dark = declarations(t, "dark");
  if (light.length === 0 && dark.length === 0) return "";
  const parts = [CSS_HEADER];
  if (light.length) parts.push(block(":root", light));
  if (dark.length) parts.push(block('[data-theme="dark"]', dark));
  return parts.join("\n\n") + "\n";
}

/* -----------------------------------------------------------------------
   Preview (resolved colours for preset thumbnails)
   ----------------------------------------------------------------------- */

export function themePreview(theme: ThemeSettings, mode: "light" | "dark"): ThemePreview {
  const t = normalizeTheme(theme);
  const m: Mode = mode === "dark" ? "dark" : "light";
  const kit = KIT[m];
  const surface = surfaceColors(t, m);
  const accent = t.accent ? resolveAccent(t, m) : kit.accent;
  const status = t.status;
  const statusColour = (key: keyof StatusColors, kitValue: string) => {
    if (!status) return kitValue;
    return m === "dark" ? shade(status[key], 0.1) : status[key];
  };
  return {
    page: surface.page,
    container: surface.container,
    raised: surface.raised,
    text: kit.text,
    textMuted: kit.textMuted,
    stroke: kit.stroke,
    accent,
    accentContent: t.accent ? readableOn(accent) : kit.accentContent,
    series: resolveSeries(t) ?? [...kit.series],
    success: statusColour("success", kit.success),
    error: statusColour("error", kit.error),
  };
}

/* -----------------------------------------------------------------------
   Presets
   ----------------------------------------------------------------------- */

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "chronos",
    name: "Chronos",
    description: "The kit as shipped: graphite actions, neutral greys.",
    theme: { mode: "light", accent: null, surface: "neutral", status: null, chart: null },
    fonts: { sans: "Geist", display: "Michroma" },
    radius: 1,
  },
  {
    id: "ember",
    name: "Ember",
    description: "Wayam orange on neutral surfaces.",
    theme: { mode: "light", accent: "#ff7b1c", surface: "neutral", status: null, chart: null },
    fonts: { sans: "Geist", display: "Michroma" },
    radius: 1,
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Clear blue on cool, blue-grey surfaces.",
    theme: { mode: "light", accent: "#2563eb", surface: "cool", status: null, chart: null },
    fonts: { sans: "Inter", display: "Inter" },
    radius: 1,
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green with warm paper surfaces.",
    theme: { mode: "light", accent: "#15803d", surface: "warm", status: null, chart: null },
    fonts: { sans: "Manrope", display: "Manrope" },
    radius: 1.25,
  },
  {
    id: "royal",
    name: "Royal",
    description: "Violet accent with surfaces tinted to match.",
    theme: { mode: "light", accent: "#6d28d9", surface: "tinted", status: null, chart: null },
    fonts: { sans: "Plus Jakarta Sans", display: "Plus Jakarta Sans" },
    radius: 1.5,
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark by default with a cyan accent.",
    theme: { mode: "dark", accent: "#22d3ee", surface: "cool", status: null, chart: null },
    fonts: { sans: "Geist", display: "Space Grotesk" },
    radius: 1,
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Crimson accent with serif display type on warm paper.",
    theme: { mode: "light", accent: "#b91c1c", surface: "warm", status: null, chart: null },
    fonts: { sans: "DM Sans", display: "Playfair Display" },
    radius: 0.25,
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Near-black accent with sharp corners.",
    theme: { mode: "light", accent: "#111827", surface: "neutral", status: null, chart: null },
    fonts: { sans: "Geist", display: "Geist" },
    radius: 0.5,
  },
];
