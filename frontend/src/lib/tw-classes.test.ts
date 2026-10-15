import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTROL_OPTIONS,
  PALETTE_FAMILIES,
  SEMANTIC_BG_COLORS,
  SEMANTIC_BORDER_COLORS,
  SEMANTIC_TEXT_COLORS,
  paletteClass,
  readControl,
  setControl,
  splitClasses,
  type Control,
} from "./tw-classes";

// String paths: jsdom's URL class is not accepted by node:fs in this environment.
const THEME_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../backend/app/templates/chronos_kit/src/chronos/theme.json",
);

describe("splitClasses", () => {
  it("splits on any whitespace and drops empties", () => {
    expect(splitClasses("  a\tb\n  c ")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitClasses("")).toEqual([]);
    expect(splitClasses("   ")).toEqual([]);
  });
});

describe("readControl", () => {
  it("returns the unprefixed class that sets the control", () => {
    expect(readControl("flex text-lg p-4", "fontSize")).toBe("text-lg");
    expect(readControl("flex text-lg p-4", "padding")).toBe("p-4");
  });

  it("returns null when the control is not set", () => {
    expect(readControl("flex p-4", "fontSize")).toBeNull();
    expect(readControl("", "fontSize")).toBeNull();
  });

  it("returns the last matching class when several are present", () => {
    expect(readControl("text-sm text-2xl text-lg", "fontSize")).toBe("text-lg");
    expect(readControl("bg-red-500 bg-page", "bgColor")).toBe("bg-page");
  });

  it("ignores variant-prefixed classes", () => {
    expect(readControl("hover:text-lg md:text-2xl", "fontSize")).toBeNull();
    expect(readControl("md:text-2xl text-sm", "fontSize")).toBe("text-sm");
    expect(readControl("dark:text-red-500", "textColor")).toBeNull();
  });

  it("ignores classes that belong to another control", () => {
    expect(readControl("text-red-500", "fontSize")).toBeNull();
    expect(readControl("text-lg", "textColor")).toBeNull();
  });

  it("handles whitespace and newlines", () => {
    expect(readControl("\n  p-2\n\trounded-lg  ", "radius")).toBe("rounded-lg");
  });
});

describe("setControl", () => {
  it("replaces the existing class and keeps everything else", () => {
    expect(setControl("flex text-lg p-4", "fontSize", "text-2xl")).toBe("flex p-4 text-2xl");
  });

  it("removes the control when value is null", () => {
    expect(setControl("flex text-lg p-4", "fontSize", null)).toBe("flex p-4");
  });

  it("adds the class when the control was absent", () => {
    expect(setControl("flex", "padding", "p-4")).toBe("flex p-4");
  });

  it("removes all matching duplicates", () => {
    expect(setControl("text-sm p-2 text-lg", "fontSize", "text-xl")).toBe("p-2 text-xl");
  });

  it("never touches variant-prefixed classes", () => {
    const input = "hover:text-lg md:text-2xl dark:text-red-500 text-sm";
    expect(setControl(input, "fontSize", "text-xl")).toBe("hover:text-lg md:text-2xl dark:text-red-500 text-xl");
    expect(setControl(input, "fontSize", null)).toBe("hover:text-lg md:text-2xl dark:text-red-500");
    expect(setControl("hover:bg-x md:p-4 bg-page", "bgColor", "bg-raised")).toBe("hover:bg-x md:p-4 bg-raised");
  });

  it("never touches classes of other controls", () => {
    expect(setControl("text-red-500 text-lg", "fontSize", "text-sm")).toBe("text-red-500 text-sm");
    expect(setControl("text-center text-lg", "textAlign", "text-left")).toBe("text-lg text-left");
    expect(setControl("px-4 p-2", "padding", "p-6")).toBe("px-4 p-6");
    expect(setControl("border-default border", "borderWidth", "border-2")).toBe("border-default border-2");
  });

  it("collapses whitespace in the output", () => {
    expect(setControl("  flex   text-lg\n\tp-4  ", "fontSize", "text-xl")).toBe("flex p-4 text-xl");
    expect(setControl("   ", "fontSize", null)).toBe("");
  });

  it("round-trips: reading back the value that was set", () => {
    const out = setControl("flex", "radius", "rounded-xl");
    expect(readControl(out, "radius")).toBe("rounded-xl");
  });

  it("does not validate value against the control options", () => {
    expect(setControl("", "display", "inline-grid")).toBe("inline-grid");
  });
});

describe("fontSize", () => {
  const cases = [
    "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl",
    "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl",
    "text-display-6xl", "text-display-base", "text-display-page", "text-display-metric",
    "text-display-metric-xl", "text-heading-lg", "text-body-md", "text-label-sm", "text-caption",
    "text-[14px]", "text-[1.5rem]",
  ];
  it.each(cases)("matches %s", (cls) => {
    expect(readControl(cls, "fontSize")).toBe(cls);
  });

  it.each([
    "text-left", "text-center", "text-justify", "text-ellipsis", "text-clip", "text-wrap",
    "text-nowrap", "text-red-500", "text-primary", "text-white", "text-[#ff0000]", "text-[var(--x)]",
    "text-display", "text-heading", "text-7", "font-bold",
  ])("does not match %s", (cls) => {
    expect(readControl(cls, "fontSize")).toBeNull();
  });
});

describe("textAlign", () => {
  it.each(["text-left", "text-center", "text-right", "text-justify", "text-start", "text-end"])("matches %s", (cls) => {
    expect(readControl(cls, "textAlign")).toBe(cls);
  });

  it("does not match text sizes or colours", () => {
    expect(readControl("text-lg text-primary", "textAlign")).toBeNull();
  });
});

describe("textColor", () => {
  it.each(SEMANTIC_TEXT_COLORS.map((c) => c.cls))("matches semantic %s", (cls) => {
    expect(readControl(cls, "textColor")).toBe(cls);
  });

  it.each([
    "text-white", "text-black", "text-transparent", "text-current", "text-inherit",
    "text-red-500", "text-slate-950", "text-emerald-500/40", "text-white/50",
    "text-[#fff]", "text-[#ff000080]", "text-[rgb(1,2,3)]", "text-[rgba(0,0,0,0.5)]",
    "text-[hsl(120,50%,50%)]", "text-[var(--brand)]", "text-primary/60",
  ])("matches colour %s", (cls) => {
    expect(readControl(cls, "textColor")).toBe(cls);
  });

  it.each([
    "text-left", "text-center", "text-right", "text-justify", "text-ellipsis", "text-clip",
    "text-wrap", "text-nowrap", "text-lg", "text-2xl", "text-[14px]", "text-display-base",
    "text-caption", "text-red", "text-unknown-500", "text-red-42", "text-[url(x.png)]",
  ])("does not match non-colour %s", (cls) => {
    expect(readControl(cls, "textColor")).toBeNull();
  });

  it("rejects palette shades that Tailwind does not ship", () => {
    expect(readControl("text-red-25", "textColor")).toBeNull();
  });
});

describe("bgColor", () => {
  it.each(SEMANTIC_BG_COLORS.map((c) => c.cls))("matches semantic %s", (cls) => {
    expect(readControl(cls, "bgColor")).toBe(cls);
  });

  it.each([
    "bg-white", "bg-black", "bg-transparent", "bg-current", "bg-inherit",
    "bg-emerald-500", "bg-slate-50", "bg-emerald-500/40", "bg-white/10",
    "bg-[#123456]", "bg-[rgb(0,0,0)]", "bg-[hsla(0,0%,0%,0.2)]", "bg-[var(--x)]",
  ])("matches colour %s", (cls) => {
    expect(readControl(cls, "bgColor")).toBe(cls);
  });

  it.each([
    "bg-gradient-to-r", "bg-cover", "bg-contain", "bg-center", "bg-top", "bg-no-repeat",
    "bg-repeat", "bg-fixed", "bg-local", "bg-scroll", "bg-none", "bg-clip-text",
    "bg-blend-multiply", "bg-[url(/a.png)]", "bg-opacity-50", "bg-emerald-42",
  ])("does not match %s", (cls) => {
    expect(readControl(cls, "bgColor")).toBeNull();
  });

  it("does not match border or text colours", () => {
    expect(readControl("border-emerald-500 text-emerald-500", "bgColor")).toBeNull();
  });
});

describe("padding, paddingX, paddingY", () => {
  it("padding owns only p-*", () => {
    expect(readControl("p-4", "padding")).toBe("p-4");
    expect(readControl("p-0.5", "padding")).toBe("p-0.5");
    expect(readControl("p-px", "padding")).toBe("p-px");
    expect(readControl("p-[13px]", "padding")).toBe("p-[13px]");
    expect(readControl("px-4 py-2 pt-1", "padding")).toBeNull();
  });

  it("paddingX owns only px-*", () => {
    expect(readControl("px-4", "paddingX")).toBe("px-4");
    expect(readControl("px-[3px]", "paddingX")).toBe("px-[3px]");
    expect(readControl("p-4 py-2", "paddingX")).toBeNull();
  });

  it("paddingY owns only py-*", () => {
    expect(readControl("py-2", "paddingY")).toBe("py-2");
    expect(readControl("p-4 px-2", "paddingY")).toBeNull();
  });

  it("setControl for padding leaves px/py/pt intact", () => {
    expect(setControl("px-4 py-2 pt-1 p-2", "padding", "p-6")).toBe("px-4 py-2 pt-1 p-6");
    expect(setControl("p-2 px-4", "paddingX", "px-8")).toBe("p-2 px-8");
    expect(setControl("p-2 px-4 py-1", "paddingY", null)).toBe("p-2 px-4");
  });
});

describe("margin, marginX, marginY", () => {
  it("margin matches m-* including negative and auto", () => {
    expect(readControl("m-4", "margin")).toBe("m-4");
    expect(readControl("-m-4", "margin")).toBe("-m-4");
    expect(readControl("m-auto", "margin")).toBe("m-auto");
    expect(readControl("m-[2px]", "margin")).toBe("m-[2px]");
  });

  it("margin does not match mx/my/mt or padding", () => {
    expect(readControl("mx-4 my-2 mt-1 p-4", "margin")).toBeNull();
  });

  it("marginX matches mx-* including negative", () => {
    expect(readControl("mx-4", "marginX")).toBe("mx-4");
    expect(readControl("-mx-4", "marginX")).toBe("-mx-4");
    expect(readControl("m-4 my-2", "marginX")).toBeNull();
  });

  it("marginY matches my-* including negative", () => {
    expect(readControl("-my-2", "marginY")).toBe("-my-2");
    expect(readControl("m-4 mx-2", "marginY")).toBeNull();
  });

  it("setControl for margin leaves mx/my intact", () => {
    expect(setControl("-mx-4 m-2", "margin", "m-8")).toBe("-mx-4 m-8");
    expect(setControl("-m-2 mx-1", "margin", null)).toBe("mx-1");
  });
});

describe("gap", () => {
  it("matches gap-* only", () => {
    expect(readControl("gap-4", "gap")).toBe("gap-4");
    expect(readControl("gap-0.5", "gap")).toBe("gap-0.5");
    expect(readControl("gap-[10px]", "gap")).toBe("gap-[10px]");
    expect(readControl("gap-x-4 gap-y-2", "gap")).toBeNull();
  });

  it("setControl for gap keeps gap-x and gap-y", () => {
    expect(setControl("gap-x-4 gap-2", "gap", "gap-6")).toBe("gap-x-4 gap-6");
  });
});

describe("radius", () => {
  it.each(["rounded", "rounded-none", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "radius")).toBe(cls);
    },
  );

  it("does not match per-side or per-corner radius", () => {
    expect(readControl("rounded-t-lg rounded-tl-md rounded-b-none rounded-r rounded-s-lg", "radius")).toBeNull();
  });

  it("does not match unknown sizes", () => {
    expect(readControl("rounded-4xl rounded-[8px]", "radius")).toBeNull();
  });
});

describe("borderWidth", () => {
  it.each(["border", "border-0", "border-2", "border-4", "border-8", "border-[3px]"])("matches %s", (cls) => {
    expect(readControl(cls, "borderWidth")).toBe(cls);
  });

  it("does not match colours, sides, or styles", () => {
    expect(readControl(
      "border-default border-t border-x-2 border-t-4 border-solid border-dashed border-emerald-500 border-[#fff] border-3 border-16",
      "borderWidth",
    )).toBeNull();
  });
});

describe("borderColor", () => {
  it.each(SEMANTIC_BORDER_COLORS.map((c) => c.cls))("matches semantic %s", (cls) => {
    expect(readControl(cls, "borderColor")).toBe(cls);
  });

  it.each(["border-emerald-500", "border-slate-200/50", "border-white", "border-black", "border-transparent", "border-[#abcdef]", "border-[rgb(1,1,1)]"])(
    "matches colour %s",
    (cls) => {
      expect(readControl(cls, "borderColor")).toBe(cls);
    },
  );

  it.each(["border", "border-0", "border-2", "border-solid", "border-dashed", "border-t-red-500", "border-x", "border-[3px]"])(
    "does not match %s",
    (cls) => {
      expect(readControl(cls, "borderColor")).toBeNull();
    },
  );

  it("setControl for borderColor leaves border width intact", () => {
    expect(setControl("border-2 border-default", "borderColor", "border-error-stroke")).toBe("border-2 border-error-stroke");
  });
});

describe("shadow", () => {
  it.each(["shadow", "shadow-none", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl", "shadow-inner"])("matches %s", (cls) => {
    expect(readControl(cls, "shadow")).toBe(cls);
  });

  it("does not match shadow colours", () => {
    expect(readControl("shadow-red-500 shadow-[#000]", "shadow")).toBeNull();
  });
});

describe("display", () => {
  it.each(["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "display")).toBe(cls);
    },
  );

  it("does not match related utilities", () => {
    expect(readControl("flex-col grid-cols-3 table hidden-x", "display")).toBeNull();
  });
});

describe("flexDirection", () => {
  it.each(["flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse"])("matches %s", (cls) => {
    expect(readControl(cls, "flexDirection")).toBe(cls);
  });

  it("does not match flex-1, flex-wrap, or display flex", () => {
    expect(readControl("flex flex-1 flex-wrap flex-nowrap flex-grow", "flexDirection")).toBeNull();
  });
});

describe("justify", () => {
  it.each(["justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly", "justify-stretch"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "justify")).toBe(cls);
    },
  );

  it("does not match justify-items or justify-self", () => {
    expect(readControl("justify-items-center justify-self-end", "justify")).toBeNull();
  });
});

describe("items", () => {
  it.each(["items-start", "items-end", "items-center", "items-baseline", "items-stretch"])("matches %s", (cls) => {
    expect(readControl(cls, "items")).toBe(cls);
  });

  it("does not match self-alignment", () => {
    expect(readControl("self-center place-items-center", "items")).toBeNull();
  });
});

describe("width", () => {
  it.each(["w-0", "w-4", "w-96", "w-px", "w-1/2", "w-2/3", "w-full", "w-screen", "w-auto", "w-min", "w-max", "w-fit", "w-[320px]"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "width")).toBe(cls);
    },
  );

  it("does not match min-w / max-w / h- classes", () => {
    expect(readControl("min-w-0 max-w-md h-full", "width")).toBeNull();
  });
});

describe("opacity", () => {
  it.each(["opacity-0", "opacity-25", "opacity-50", "opacity-100", "opacity-[0.3]"])("matches %s", (cls) => {
    expect(readControl(cls, "opacity")).toBe(cls);
  });

  it("does not match bg-opacity or text-opacity", () => {
    expect(readControl("bg-opacity-50 text-opacity-50", "opacity")).toBeNull();
  });
});

describe("fontFamily", () => {
  it.each(["font-sans", "font-display", "font-mono", "font-serif"])("matches %s", (cls) => {
    expect(readControl(cls, "fontFamily")).toBe(cls);
  });

  it("does not match font weights", () => {
    expect(readControl("font-bold font-normal", "fontFamily")).toBeNull();
  });
});

describe("fontWeight", () => {
  it.each(["font-thin", "font-extralight", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "fontWeight")).toBe(cls);
    },
  );

  it("does not match families", () => {
    expect(readControl("font-sans font-mono font-display", "fontWeight")).toBeNull();
  });

  it("setControl for fontWeight keeps fontFamily", () => {
    expect(setControl("font-mono font-bold", "fontWeight", "font-black")).toBe("font-mono font-black");
  });
});

describe("tracking", () => {
  it.each(["tracking-tighter", "tracking-tight", "tracking-normal", "tracking-wide", "tracking-wider", "tracking-widest", "tracking-[0.2em]"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "tracking")).toBe(cls);
    },
  );

  it("does not match leading", () => {
    expect(readControl("leading-tight", "tracking")).toBeNull();
  });
});

describe("leading", () => {
  it.each(["leading-none", "leading-tight", "leading-snug", "leading-normal", "leading-relaxed", "leading-loose", "leading-3", "leading-10", "leading-[1.6]"])(
    "matches %s",
    (cls) => {
      expect(readControl(cls, "leading")).toBe(cls);
    },
  );

  it("does not match tracking", () => {
    expect(readControl("tracking-wide", "leading")).toBeNull();
  });
});

describe("paletteClass", () => {
  it("builds a palette class", () => {
    expect(paletteClass("bg", "emerald", 500)).toBe("bg-emerald-500");
    expect(paletteClass("text", "slate", 950)).toBe("text-slate-950");
    expect(paletteClass("border", "rose", 50)).toBe("border-rose-50");
  });

  it("rejects unknown families and shades", () => {
    expect(() => paletteClass("text", "chartreuse", 500)).toThrow(RangeError);
    expect(() => paletteClass("bg", "red", 25)).toThrow(RangeError);
  });

  it("lists the Tailwind families from slate to rose", () => {
    expect(PALETTE_FAMILIES[0]).toBe("slate");
    expect(PALETTE_FAMILIES[PALETTE_FAMILIES.length - 1]).toBe("rose");
    expect(new Set(PALETTE_FAMILIES).size).toBe(PALETTE_FAMILIES.length);
  });
});

describe("CONTROL_OPTIONS", () => {
  const controls = Object.keys(CONTROL_OPTIONS) as Control[];

  it("defines options for every control", () => {
    expect(controls).toHaveLength(25);
    for (const c of controls) {
      expect(CONTROL_OPTIONS[c].length).toBeGreaterThan(0);
    }
  });

  it("every offered option is owned by its own control", () => {
    for (const c of controls) {
      for (const opt of CONTROL_OPTIONS[c]) {
        expect(readControl(opt, c), `${c} option ${opt}`).toBe(opt);
      }
    }
  });

  it("no option is claimed by a second control", () => {
    const owners = new Map<string, Control[]>();
    for (const c of controls) {
      for (const opt of CONTROL_OPTIONS[c]) {
        owners.set(opt, [...(owners.get(opt) ?? []), c]);
      }
    }
    const overlaps = [...owners.entries()].filter(([, cs]) => cs.length > 1);
    expect(overlaps).toEqual([]);
  });

  it("matches the spec's ordered values for the sample controls", () => {
    expect(CONTROL_OPTIONS.fontSize).toEqual(["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"]);
    expect(CONTROL_OPTIONS.padding).toEqual(["p-0", "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-8", "p-10", "p-12"]);
    expect(CONTROL_OPTIONS.radius).toEqual(["rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"]);
    expect(CONTROL_OPTIONS.fontFamily).toEqual(["font-sans", "font-display", "font-mono"]);
    expect(CONTROL_OPTIONS.shadow).toEqual(["shadow-none", "shadow-sm", "shadow", "shadow-md", "shadow-lg"]);
    expect(CONTROL_OPTIONS.display).toEqual(["block", "inline-block", "flex", "inline-flex", "grid", "hidden"]);
  });
});

describe("semantic colour lists", () => {
  it("text colours are exactly the nine Chronos text roles", () => {
    expect(SEMANTIC_TEXT_COLORS.map((c) => c.cls)).toEqual([
      "text-primary", "text-secondary", "text-tertiary", "text-quaternary", "text-on-color",
      "text-success", "text-info", "text-warning", "text-error",
    ]);
  });

  it("every swatch is a CSS variable reference", () => {
    for (const c of [...SEMANTIC_TEXT_COLORS, ...SEMANTIC_BG_COLORS, ...SEMANTIC_BORDER_COLORS]) {
      expect(c.swatch).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it("every class uses its own prefix", () => {
    expect(SEMANTIC_TEXT_COLORS.every((c) => c.cls.startsWith("text-"))).toBe(true);
    expect(SEMANTIC_BG_COLORS.every((c) => c.cls.startsWith("bg-"))).toBe(true);
    expect(SEMANTIC_BORDER_COLORS.every((c) => c.cls.startsWith("border-"))).toBe(true);
  });

  const themeTest = existsSync(THEME_PATH) ? it : it.skip;
  themeTest("every semantic class is defined by theme.json", () => {
    const theme = JSON.parse(readFileSync(THEME_PATH, "utf8")) as {
      colors: Record<string, string>;
      fontSize: Record<string, unknown>;
    };
    const keys = new Set(Object.keys(theme.colors));
    for (const c of SEMANTIC_TEXT_COLORS) expect(keys.has(c.cls.slice(5)), c.cls).toBe(true);
    for (const c of SEMANTIC_BG_COLORS) expect(keys.has(c.cls.slice(3)), c.cls).toBe(true);
    for (const c of SEMANTIC_BORDER_COLORS) expect(keys.has(c.cls.slice(7)), c.cls).toBe(true);
  });

  themeTest("every theme fontSize key is recognised as a fontSize", () => {
    const theme = JSON.parse(readFileSync(THEME_PATH, "utf8")) as { fontSize: Record<string, unknown> };
    for (const key of Object.keys(theme.fontSize)) {
      expect(readControl(`text-${key}`, "fontSize"), key).toBe(`text-${key}`);
      expect(readControl(`text-${key}`, "textColor"), key).toBeNull();
    }
  });
});

describe("cross-control isolation", () => {
  it("text sizes and text colours never collide", () => {
    const input = "text-lg text-red-500 text-center text-primary";
    expect(readControl(input, "fontSize")).toBe("text-lg");
    expect(readControl(input, "textColor")).toBe("text-primary");
    expect(readControl(input, "textAlign")).toBe("text-center");
  });

  it("a full style round trip keeps unrelated classes", () => {
    let cls = "flex items-center hover:bg-x md:text-lg dark:bg-black p-2";
    cls = setControl(cls, "fontSize", "text-3xl");
    cls = setControl(cls, "bgColor", "bg-emerald-500/40");
    cls = setControl(cls, "radius", "rounded-xl");
    cls = setControl(cls, "bgColor", "bg-raised");
    expect(cls).toBe("flex items-center hover:bg-x md:text-lg dark:bg-black p-2 text-3xl rounded-xl bg-raised");
  });
});
