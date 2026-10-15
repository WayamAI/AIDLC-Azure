/**
 * Design editor model for AI-generated apps.
 *
 * Pure TypeScript (no React, no DOM). The editor recolours the Tailwind v3
 * palette families an app uses, picks fonts and a radius scale. The result is
 * stored as `design.json` in the generated project and read by both the live
 * preview (Tailwind Play CDN config) and the real `tailwind.config.js`.
 */

export const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
export type Shades = Record<(typeof SHADES)[number], string>;
type Shade = (typeof SHADES)[number];

export const TAILWIND_FAMILIES: string[] = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
  "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

export const NEUTRAL_FAMILIES: string[] = ["slate", "gray", "zinc", "neutral", "stone"];

/** Official Tailwind v3 palette, 500 shade. */
export const TAILWIND_500: Record<string, string> = {
  slate: "#64748b",
  gray: "#6b7280",
  zinc: "#71717a",
  neutral: "#737373",
  stone: "#78716c",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const HEX6_RE = /^#?([0-9a-f]{6})$/i;
const HEX3_RE = /^#?([0-9a-f]{3})$/i;

/** Returns lowercase `#rrggbb`, or null when the input is not a 3/6-digit hex colour. */
function normaliseHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  const m6 = HEX6_RE.exec(s);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = HEX3_RE.exec(s);
  if (m3) {
    const [r, g, b] = m3[1].toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** RGB 0-255 -> [hue 0-360, saturation 0-100, lightness 0-100]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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
  return [h, s * 100, l * 100];
}

/** [hue deg, saturation 0-100, lightness 0-100] -> RGB 0-255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1] = [c, x];
  else if (hp < 2) [r1, g1] = [x, c];
  else if (hp < 3) [g1, b1] = [c, x];
  else if (hp < 4) [g1, b1] = [x, c];
  else if (hp < 5) [r1, b1] = [x, c];
  else [r1, b1] = [c, x];
  const m = ln - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Fraction of the way from the input lightness toward white (light) or black (dark). */
const LIGHT_MIX: Partial<Record<Shade, number>> = { "50": 0.92, "100": 0.84, "200": 0.68, "300": 0.48, "400": 0.24 };
const DARK_MIX: Partial<Record<Shade, number>> = { "600": 0.18, "700": 0.36, "800": 0.55, "900": 0.72, "950": 0.88 };

/**
 * Builds an 11-step scale around the input colour. The 500 shade is the input
 * itself; lighter shades move toward white and darker shades toward black in
 * HSL lightness, keeping hue and saturation. Lightness is strictly decreasing
 * from 50 to 950 for any input that leaves room on both ends.
 */
export function generateShades(hex: string): Shades {
  const base = normaliseHex(hex);
  if (!base) throw new Error(`generateShades: invalid hex colour "${String(hex)}"`);
  const [h, s, l] = rgbToHsl(...hexToRgb(base));
  const top = Math.min(100, Math.max(98, l + 1));
  const bottom = Math.max(0, Math.min(4, l - 1));

  const out = {} as Shades;
  for (const shade of SHADES) {
    if (shade === "500") {
      out[shade] = base;
      continue;
    }
    const light = LIGHT_MIX[shade];
    const targetL =
      light !== undefined ? l + (top - l) * light : l - (l - bottom) * (DARK_MIX[shade] ?? 0);
    out[shade] = rgbToHex(...hslToRgb(h, s, targetL));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scanning generated source for colour usage
// ---------------------------------------------------------------------------

export type UsedFamily = { family: string; count: number };
export type HexUsage = { hex: string; count: number };

const SCANNED_EXT = /\.(ts|tsx|js|jsx|css)$/i;

/** Utility prefixes that take a colour. */
const COLOUR_PREFIXES = [
  "bg", "text", "border", "border-x", "border-y", "border-t", "border-r", "border-b", "border-l",
  "ring", "ring-offset", "from", "via", "to", "fill", "stroke", "divide", "outline",
  "decoration", "placeholder", "shadow", "accent", "caret",
];

const FAMILY_CLASS_RE = new RegExp(
  `^(?:${COLOUR_PREFIXES.join("|")})-([a-z]+)-(\\d{2,3})(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]]*\\]))?$`,
);

const ARBITRARY_HEX_RE = new RegExp(
  `(?<![\\w-])(?:${COLOUR_PREFIXES.join("|")})-\\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\]`,
  "g",
);

function scannable(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((path) => SCANNED_EXT.test(path))
    .map((path) => files[path] ?? "");
}

/**
 * Counts Tailwind palette-family class usages (e.g. `hover:bg-emerald-500`,
 * `from-violet-600/40`) across source files. Only families in
 * TAILWIND_FAMILIES and shades in SHADES are counted.
 */
export function scanPaletteUsage(files: Record<string, string>): UsedFamily[] {
  const counts = new Map<string, number>();
  for (const text of scannable(files)) {
    for (const raw of text.split(/[\s"'`{}<>(),;=]+/)) {
      if (!raw) continue;
      const cls = raw.replace(/^!/, "").split(":").pop() ?? "";
      const m = FAMILY_CLASS_RE.exec(cls);
      if (!m) continue;
      const [, family, shade] = m;
      if (!TAILWIND_FAMILIES.includes(family) || !(SHADES as readonly string[]).includes(shade)) continue;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/** Counts arbitrary-value colours such as `bg-[#0f172a]` or `text-[#fff]`, normalised to lowercase `#rrggbb`. */
export function scanArbitraryHex(files: Record<string, string>): HexUsage[] {
  const counts = new Map<string, number>();
  for (const text of scannable(files)) {
    for (const m of text.matchAll(ARBITRARY_HEX_RE)) {
      const hex = normaliseHex(m[1]);
      if (!hex) continue;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export type FontChoice = { name: string; stack: string[]; googleFamily: string | null };

const SYSTEM_STACK = [
  "ui-sans-serif",
  "system-ui",
  "sans-serif",
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"',
  '"Segoe UI Symbol"',
  '"Noto Color Emoji"',
];

export const FONT_CHOICES: FontChoice[] = [
  { name: "System", stack: SYSTEM_STACK, googleFamily: null },
  { name: "Inter", stack: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], googleFamily: "Inter" },
  { name: "Geist", stack: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"], googleFamily: "Geist" },
  { name: "Manrope", stack: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"], googleFamily: "Manrope" },
  {
    name: "Plus Jakarta Sans",
    stack: ['"Plus Jakarta Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
    googleFamily: "Plus Jakarta Sans",
  },
  { name: "DM Sans", stack: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"], googleFamily: "DM Sans" },
  {
    name: "Space Grotesk",
    stack: ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
    googleFamily: "Space Grotesk",
  },
  { name: "Outfit", stack: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"], googleFamily: "Outfit" },
  {
    name: "Playfair Display",
    stack: ['"Playfair Display"', "ui-serif", "Georgia", "serif"],
    googleFamily: "Playfair Display",
  },
  {
    name: "JetBrains Mono",
    stack: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
    googleFamily: "JetBrains Mono",
  },
];

const SYSTEM_FONT = FONT_CHOICES[0];

function fontChoice(name: unknown): FontChoice {
  if (typeof name !== "string") return SYSTEM_FONT;
  const wanted = name.trim().toLowerCase();
  return FONT_CHOICES.find((f) => f.name.toLowerCase() === wanted) ?? SYSTEM_FONT;
}

function googleCss2Url(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`;
}

// ---------------------------------------------------------------------------
// Design file
// ---------------------------------------------------------------------------

export type DesignFile = {
  version: 1;
  preset: string;
  palette: Record<string, string>;
  fonts: { sans: string; display: string };
  radius: number;
  tailwind: { darkMode: "class"; theme: { extend: Record<string, unknown> } };
  fontLinks: string[];
};

/** Tailwind v3 default radii (rem) and the 9999px `full` value. */
const RADIUS_DEFAULTS: Array<[string, number]> = [
  ["sm", 0.125],
  ["DEFAULT", 0.25],
  ["md", 0.375],
  ["lg", 0.5],
  ["xl", 0.75],
  ["2xl", 1],
  ["3xl", 1.5],
];

function clampRadius(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n));
}

function radiusScale(radius: number): Record<string, string> {
  const scale: Record<string, string> = {};
  for (const [key, base] of RADIUS_DEFAULTS) {
    scale[key] = `${Number((base * radius).toFixed(4))}rem`;
  }
  scale.full = "9999px";
  return scale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds a complete design file, computing `tailwind` and `fontLinks` from the inputs. */
export function buildDesign(input: {
  preset: string;
  palette: Record<string, string>;
  fonts: { sans: string; display: string };
  radius: number;
}): DesignFile {
  const palette: Record<string, string> = {};
  const colors: Record<string, Shades> = {};
  for (const [family, value] of Object.entries(isRecord(input.palette) ? input.palette : {})) {
    if (!TAILWIND_FAMILIES.includes(family)) continue;
    const hex = normaliseHex(value);
    if (!hex || hex === TAILWIND_500[family]) continue; // not an override
    palette[family] = hex;
    colors[family] = generateShades(hex);
  }

  const sans = fontChoice(input.fonts?.sans);
  const display = fontChoice(input.fonts?.display);
  const radius = clampRadius(input.radius);

  const extend: Record<string, unknown> = {};
  if (Object.keys(colors).length > 0) extend.colors = colors;
  if (sans.name !== SYSTEM_FONT.name || display.name !== SYSTEM_FONT.name) {
    extend.fontFamily = { sans: [...sans.stack], display: [...display.stack] };
  }
  extend.borderRadius = radiusScale(radius);

  const fontLinks: string[] = [];
  for (const font of [sans, display]) {
    if (font.googleFamily === null) continue;
    const url = googleCss2Url(font.googleFamily);
    if (!fontLinks.includes(url)) fontLinks.push(url);
  }

  const preset = typeof input.preset === "string" && input.preset.trim() ? input.preset.trim() : "custom";

  return {
    version: 1,
    preset,
    palette,
    fonts: { sans: sans.name, display: display.name },
    radius,
    tailwind: { darkMode: "class", theme: { extend } },
    fontLinks,
  };
}

function defaultDesign(): DesignFile {
  return buildDesign({ preset: "custom", palette: {}, fonts: { sans: "System", display: "System" }, radius: 1 });
}

export const DEFAULT_DESIGN: DesignFile = defaultDesign();

/**
 * Tolerant reader: anything missing or invalid falls back to defaults, and
 * `tailwind` and `fontLinks` are always recomputed from the inputs.
 */
export function parseDesign(text: string | undefined | null): DesignFile {
  if (typeof text !== "string" || text.trim() === "") return defaultDesign();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultDesign();
  }
  if (!isRecord(raw)) return defaultDesign();
  const fonts = isRecord(raw.fonts) ? raw.fonts : {};
  return buildDesign({
    preset: typeof raw.preset === "string" ? raw.preset : "custom",
    palette: isRecord(raw.palette) ? (raw.palette as Record<string, string>) : {},
    fonts: {
      sans: typeof fonts.sans === "string" ? fonts.sans : "System",
      display: typeof fonts.display === "string" ? fonts.display : "System",
    },
    radius: raw.radius as number,
  });
}

export function serializeDesign(d: DesignFile): string {
  return JSON.stringify(d, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type DesignPreset = {
  id: string;
  name: string;
  description: string;
  palette: Record<string, string>;
  fonts: { sans: string; display: string };
  radius: number;
};

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "ocean",
    name: "Ocean",
    description: "Sky and blue accents with a clean Inter UI.",
    palette: { sky: "#0284c7", blue: "#2563eb", cyan: "#0891b2" },
    fonts: { sans: "Inter", display: "Inter" },
    radius: 1,
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm orange, rose and amber with Outfit headings.",
    palette: { orange: "#ea580c", rose: "#e11d48", amber: "#d97706" },
    fonts: { sans: "Outfit", display: "Outfit" },
    radius: 1,
  },
  {
    id: "forest",
    name: "Forest",
    description: "Emerald, green and teal with Manrope.",
    palette: { emerald: "#059669", green: "#16a34a", teal: "#0d9488" },
    fonts: { sans: "Manrope", display: "Manrope" },
    radius: 1,
  },
  {
    id: "royal",
    name: "Royal",
    description: "Violet, indigo and purple with Plus Jakarta Sans.",
    palette: { violet: "#7c3aed", indigo: "#4f46e5", purple: "#9333ea" },
    fonts: { sans: "Plus Jakarta Sans", display: "Plus Jakarta Sans" },
    radius: 1,
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Cool grey neutrals, a blue accent, Geist and tighter corners.",
    palette: {
      slate: "#4a5568",
      gray: "#4a5568",
      zinc: "#4a5568",
      neutral: "#4a5568",
      stone: "#4a5568",
      blue: "#2563eb",
    },
    fonts: { sans: "Geist", display: "Geist" },
    radius: 0.5,
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Warm stone neutrals and a red accent with Playfair Display headings.",
    palette: { stone: "#57534e", red: "#b91c1c" },
    fonts: { sans: "DM Sans", display: "Playfair Display" },
    radius: 0.25,
  },
];

/**
 * Maps the app's most-used non-neutral families, in order, onto the preset's
 * accent colours, and its neutral families onto the preset's neutral colour
 * (when it has one). Returns app family -> hex.
 */
export function applyPresetToUsage(preset: DesignPreset, used: UsedFamily[]): Record<string, string> {
  const entries = Object.entries(preset.palette)
    .map(([family, hex]) => [family, normaliseHex(hex)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null);
  const accents = entries.filter(([family]) => !NEUTRAL_FAMILIES.includes(family));
  const neutral = entries.find(([family]) => NEUTRAL_FAMILIES.includes(family));

  const ordered = used
    .filter((u) => TAILWIND_FAMILIES.includes(u.family))
    .slice()
    .sort((a, b) => b.count - a.count);

  const out: Record<string, string> = {};
  let accentIndex = 0;
  for (const { family } of ordered) {
    if (NEUTRAL_FAMILIES.includes(family)) {
      if (neutral) out[family] = neutral[1];
      continue;
    }
    if (accentIndex < accents.length) {
      out[family] = accents[accentIndex][1];
      accentIndex += 1;
    }
  }
  return out;
}
