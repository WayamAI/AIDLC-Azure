import { extendTailwindMerge } from "tailwind-merge";

import theme from "./theme.json";

/*
 * Class merging for kit components. Built from theme.json so every custom
 * font size and colour name is known to tailwind-merge. Without this, a name
 * such as `text-caption` or `text-tertiary` would be read as a colour and
 * would drop the other text class it sits beside.
 *
 * Each name is registered in exactly one group: tailwind-merge keeps one
 * group per literal class, so a name listed twice would lose its group.
 */

const FONT_SIZE_NAMES = Object.keys(theme.fontSize);
const COLOUR_NAMES = Object.keys(theme.colors);

const twMergeKit = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZE_NAMES }],
      "text-color": [{ text: COLOUR_NAMES }],
      "bg-color": [{ bg: COLOUR_NAMES }],
      "border-color": [{ border: COLOUR_NAMES }],
    },
  },
});

/**
 * Joins Tailwind class strings. Later classes win over earlier ones that set
 * the same CSS property, so `cx(defaults, className)` lets a caller's classes
 * override a component's defaults. Non-string arguments are ignored.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  const classes = parts.filter((part): part is string => typeof part === "string" && part.trim() !== "");
  return twMergeKit(classes.join(" "));
}
