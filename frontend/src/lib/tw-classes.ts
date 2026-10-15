/**
 * Read and write one style "control" of a Tailwind v3 className string.
 *
 * A control owns a fixed set of UNPREFIXED classes (e.g. `text-lg` for
 * fontSize). Variant-prefixed classes (`hover:bg-x`, `md:text-lg`, `dark:...`)
 * are never considered part of any control and are always preserved, even when
 * they look like a control's class. Arbitrary values in brackets are matched
 * as one token; a colon inside brackets or parentheses is not a variant.
 *
 * Each control only owns its own prefix: setting `padding` does not touch
 * `px-*` or `pt-*`, and `gap` does not touch `gap-x-*`/`gap-y-*`.
 */

export type Control =
  | "fontSize"
  | "fontWeight"
  | "textAlign"
  | "textColor"
  | "bgColor"
  | "padding"
  | "paddingX"
  | "paddingY"
  | "margin"
  | "marginX"
  | "marginY"
  | "gap"
  | "radius"
  | "borderWidth"
  | "borderColor"
  | "shadow"
  | "display"
  | "flexDirection"
  | "justify"
  | "items"
  | "width"
  | "opacity"
  | "fontFamily"
  | "tracking"
  | "leading";

export interface SemanticColor {
  label: string;
  cls: string;
  /** CSS colour expression, usable as `style={{ background: swatch }}`. */
  swatch: string;
}

/** Chronos semantic text colours (theme.json `colors`, text-* group). */
export const SEMANTIC_TEXT_COLORS: SemanticColor[] = [
  { label: "Primary", cls: "text-primary", swatch: "var(--text-primary)" },
  { label: "Secondary", cls: "text-secondary", swatch: "var(--text-secondary)" },
  { label: "Tertiary", cls: "text-tertiary", swatch: "var(--text-tertiary)" },
  { label: "Quaternary", cls: "text-quaternary", swatch: "var(--text-quaternary)" },
  { label: "On colour", cls: "text-on-color", swatch: "var(--text-on-color)" },
  { label: "Success", cls: "text-success", swatch: "var(--feedback-success-content)" },
  { label: "Info", cls: "text-info", swatch: "var(--feedback-info-content)" },
  { label: "Warning", cls: "text-warning", swatch: "var(--feedback-warning-content)" },
  { label: "Error", cls: "text-error", swatch: "var(--feedback-error-content)" },
];

/** Chronos semantic background colours (theme.json `colors`, surfaces). */
export const SEMANTIC_BG_COLORS: SemanticColor[] = [
  { label: "Page", cls: "bg-page", swatch: "var(--surface-page-background)" },
  { label: "Container", cls: "bg-container", swatch: "var(--surface-container)" },
  { label: "Raised", cls: "bg-raised", swatch: "var(--surface-raised)" },
  { label: "Raised 2", cls: "bg-raised-2", swatch: "var(--surface-raised-x2)" },
  { label: "Action", cls: "bg-action", swatch: "var(--surface-action)" },
  { label: "Action primary", cls: "bg-action-primary", swatch: "var(--action-primary-default)" },
  { label: "Action secondary", cls: "bg-action-secondary", swatch: "var(--action-secondary-default)" },
  { label: "Action tertiary", cls: "bg-action-tertiary", swatch: "var(--action-tertiary-default)" },
  { label: "Success surface", cls: "bg-success-surface", swatch: "var(--feedback-success-background)" },
  { label: "Info surface", cls: "bg-info-surface", swatch: "var(--feedback-info-background)" },
  { label: "Neutral surface", cls: "bg-neutral-surface", swatch: "var(--feedback-neutral-background)" },
  { label: "Warning surface", cls: "bg-warning-surface", swatch: "var(--feedback-warning-background)" },
  { label: "Error surface", cls: "bg-error-surface", swatch: "var(--feedback-error-background)" },
];

/** Chronos semantic border colours (theme.json `colors`, stroke group). */
export const SEMANTIC_BORDER_COLORS: SemanticColor[] = [
  { label: "Default", cls: "border-default", swatch: "var(--stroke-default)" },
  { label: "Active", cls: "border-active", swatch: "var(--stroke-active)" },
  { label: "Muted", cls: "border-muted", swatch: "var(--stroke-muted)" },
  { label: "Disabled", cls: "border-disabled", swatch: "var(--stroke-disabled)" },
  { label: "On colour", cls: "border-on-color-stroke", swatch: "var(--stroke-on-color)" },
  { label: "Success", cls: "border-success-stroke", swatch: "var(--feedback-success-stroke)" },
  { label: "Info", cls: "border-info-stroke", swatch: "var(--feedback-info-stroke)" },
  { label: "Neutral", cls: "border-neutral-stroke", swatch: "var(--feedback-neutral-stroke)" },
  { label: "Warning", cls: "border-warning-stroke", swatch: "var(--feedback-warning-stroke)" },
  { label: "Error", cls: "border-error-stroke", swatch: "var(--feedback-error-stroke)" },
];

/** Tailwind v3 default palette families, in UI order. */
export const PALETTE_FAMILIES: string[] = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

const PALETTE_SHADES: number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Builds a Tailwind palette class, e.g. `paletteClass("bg", "emerald", 500)` -> `bg-emerald-500`. */
export function paletteClass(prefix: "text" | "bg" | "border", family: string, shade: number): string {
  if (!PALETTE_FAMILIES.includes(family)) {
    throw new RangeError(`Unknown palette family: ${family}`);
  }
  if (!PALETTE_SHADES.includes(shade)) {
    throw new RangeError(`Unknown palette shade: ${shade}`);
  }
  return `${prefix}-${family}-${shade}`;
}

/** Ordered class values offered in the UI for each control. */
export const CONTROL_OPTIONS: Record<Control, string[]> = {
  fontSize: ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"],
  fontWeight: ["font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-black"],
  textAlign: ["text-left", "text-center", "text-right", "text-justify"],
  textColor: SEMANTIC_TEXT_COLORS.map((c) => c.cls),
  bgColor: SEMANTIC_BG_COLORS.map((c) => c.cls),
  padding: ["p-0", "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-8", "p-10", "p-12"],
  paddingX: ["px-0", "px-1", "px-2", "px-3", "px-4", "px-5", "px-6", "px-8", "px-10", "px-12"],
  paddingY: ["py-0", "py-1", "py-2", "py-3", "py-4", "py-5", "py-6", "py-8", "py-10", "py-12"],
  margin: ["m-0", "m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-8", "m-10", "m-12"],
  marginX: ["mx-0", "mx-1", "mx-2", "mx-3", "mx-4", "mx-5", "mx-6", "mx-8", "mx-10", "mx-12"],
  marginY: ["my-0", "my-1", "my-2", "my-3", "my-4", "my-5", "my-6", "my-8", "my-10", "my-12"],
  gap: ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4", "gap-5", "gap-6", "gap-8", "gap-10", "gap-12"],
  radius: ["rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"],
  borderWidth: ["border", "border-0", "border-2", "border-4", "border-8"],
  borderColor: SEMANTIC_BORDER_COLORS.map((c) => c.cls),
  shadow: ["shadow-none", "shadow-sm", "shadow", "shadow-md", "shadow-lg"],
  display: ["block", "inline-block", "flex", "inline-flex", "grid", "hidden"],
  flexDirection: ["flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse"],
  justify: ["justify-start", "justify-center", "justify-end", "justify-between", "justify-around", "justify-evenly"],
  items: ["items-start", "items-center", "items-end", "items-baseline", "items-stretch"],
  width: ["w-auto", "w-1/4", "w-1/3", "w-1/2", "w-2/3", "w-3/4", "w-full"],
  opacity: ["opacity-0", "opacity-25", "opacity-50", "opacity-75", "opacity-100"],
  fontFamily: ["font-sans", "font-display", "font-mono"],
  tracking: ["tracking-tighter", "tracking-tight", "tracking-normal", "tracking-wide", "tracking-wider", "tracking-widest"],
  leading: ["leading-none", "leading-tight", "leading-snug", "leading-normal", "leading-relaxed", "leading-loose"],
};

// ---------------------------------------------------------------------------
// Membership rules
// ---------------------------------------------------------------------------

const ARB = String.raw`\[[^\]]+\]`;
/** Arbitrary length, e.g. `[14px]`, `[1.5rem]`. */
const ARB_LENGTH = String.raw`\[\d*\.?\d+(?:px|rem|em)\]`;
/** Arbitrary colour: hex, rgb(), hsl() or var(). */
const ARB_COLOUR = String.raw`\[(?:#|rgba?\(|hsla?\(|var\()[^\]]*\]`;
/** Opacity modifier on a colour, e.g. `/40` or `/[.37]`. */
const OPACITY = String.raw`(?:\/(?:\d+|\[[^\]]+\]))?`;
/** Spacing scale value: `0`, `0.5`, `4`, `96`, or `px`. */
const SPACE = String.raw`(?:\d+(?:\.\d+)?|px)`;

const FAMILY_ALT = PALETTE_FAMILIES.join("|");
const SHADE_ALT = PALETTE_SHADES.join("|");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function colourRegex(prefix: "text" | "bg" | "border", semantic: SemanticColor[], keywords: string[]): RegExp {
  const names = semantic.map((c) => escapeRe(c.cls.slice(prefix.length + 1)));
  const alts = [
    ...names,
    ...keywords,
    `(?:${FAMILY_ALT})-(?:${SHADE_ALT})`,
    ARB_COLOUR,
  ];
  return new RegExp(`^${prefix}-(?:${alts.join("|")})${OPACITY}$`);
}

const TEXT_COLOUR_KEYWORDS = ["white", "black", "transparent", "current", "inherit"];

const MATCHERS: Record<Control, RegExp> = {
  fontSize: new RegExp(
    `^text-(?:xs|sm|base|lg|xl|[2-9]xl` +
      `|display-(?:6xl|5xl|4xl|3xl|2xl|xl|lg|base|page|metric|metric-xl)` +
      `|heading-(?:lg|md|sm)|body-(?:lg|md|sm)|label-(?:md|sm)|caption` +
      `|${ARB_LENGTH})$`,
  ),
  fontWeight: /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  textAlign: /^text-(?:left|center|right|justify|start|end)$/,
  textColor: colourRegex("text", SEMANTIC_TEXT_COLORS, TEXT_COLOUR_KEYWORDS),
  bgColor: colourRegex("bg", SEMANTIC_BG_COLORS, ["white", "black", "transparent", "current", "inherit"]),
  padding: new RegExp(`^p-(?:${SPACE}|${ARB})$`),
  paddingX: new RegExp(`^px-(?:${SPACE}|${ARB})$`),
  paddingY: new RegExp(`^py-(?:${SPACE}|${ARB})$`),
  margin: new RegExp(`^-?m-(?:${SPACE}|auto|${ARB})$`),
  marginX: new RegExp(`^-?mx-(?:${SPACE}|auto|${ARB})$`),
  marginY: new RegExp(`^-?my-(?:${SPACE}|auto|${ARB})$`),
  gap: new RegExp(`^gap-(?:${SPACE}|${ARB})$`),
  radius: /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/,
  borderWidth: new RegExp(`^border(?:-(?:0|2|4|8)|-${ARB_LENGTH})?$`),
  borderColor: colourRegex("border", SEMANTIC_BORDER_COLORS, ["white", "black", "transparent", "current", "inherit"]),
  shadow: /^shadow(?:-(?:none|sm|md|lg|xl|2xl|inner))?$/,
  display: /^(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/,
  flexDirection: /^flex-(?:row|row-reverse|col|col-reverse)$/,
  justify: /^justify-(?:normal|start|end|center|between|around|evenly|stretch)$/,
  items: /^items-(?:start|end|center|baseline|stretch)$/,
  width: new RegExp(`^w-(?:${SPACE}|\\d+\\/\\d+|full|screen|auto|min|max|fit|${ARB})$`),
  opacity: new RegExp(
    `^opacity-(?:(?:${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100].join("|")})|${ARB})$`,
  ),
  fontFamily: /^font-(?:sans|serif|mono|display)$/,
  tracking: new RegExp(`^tracking-(?:tighter|tight|normal|wide|wider|widest|${ARB})$`),
  leading: new RegExp(`^leading-(?:none|tight|snug|normal|relaxed|loose|3|4|5|6|7|8|9|10|${ARB})$`),
};

/**
 * True when the class carries a variant prefix (`hover:`, `md:`, `dark:` ...).
 * A colon only counts when it sits outside brackets and parentheses, so
 * arbitrary values such as `bg-[url(https://x)]` are not variants.
 */
function hasVariant(cls: string): boolean {
  let depth = 0;
  for (const ch of cls) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return true;
  }
  return false;
}

function ownsClass(control: Control, cls: string): boolean {
  return !hasVariant(cls) && MATCHERS[control].test(cls);
}

/** Splits a className string on whitespace, dropping empty tokens. */
export function splitClasses(className: string): string[] {
  return (className ?? "").split(/\s+/).filter((c) => c.length > 0);
}

/**
 * The unprefixed class currently setting `control`, or null. When several
 * classes match, the last one in the className string wins.
 */
export function readControl(className: string, control: Control): string | null {
  let found: string | null = null;
  for (const cls of splitClasses(className)) {
    if (ownsClass(control, cls)) found = cls;
  }
  return found;
}

/**
 * Removes every unprefixed class owned by `control`, then appends `value`
 * (or nothing when `value` is null). Variant-prefixed and other controls'
 * classes are kept in their original order. Whitespace is collapsed.
 */
export function setControl(className: string, control: Control, value: string | null): string {
  const kept = splitClasses(className).filter((cls) => !ownsClass(control, cls));
  if (value != null) kept.push(...splitClasses(value));
  return kept.join(" ");
}
