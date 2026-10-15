import { describe, expect, it } from "vitest";
import {
  applyPresetToUsage,
  buildDesign,
  DEFAULT_DESIGN,
  DESIGN_PRESETS,
  FONT_CHOICES,
  generateShades,
  NEUTRAL_FAMILIES,
  parseDesign,
  scanArbitraryHex,
  scanPaletteUsage,
  serializeDesign,
  SHADES,
  TAILWIND_500,
  TAILWIND_FAMILIES,
} from "./app-design";

const HEX_RE = /^#[0-9a-f]{6}$/;

/** HSL lightness (0-100) of a #rrggbb colour. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const vals = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return ((Math.max(...vals) + Math.min(...vals)) / 2) * 100;
}

describe("generateShades", () => {
  const inputs = ["#3b82f6", "#64748b", "#f59e0b", "#10b981", "#7c3aed", "#ea580c", "#0f172a"];

  it("returns every shade as a lowercase #rrggbb string", () => {
    for (const input of inputs) {
      const shades = generateShades(input);
      expect(Object.keys(shades)).toEqual([...SHADES]);
      for (const shade of SHADES) expect(shades[shade]).toMatch(HEX_RE);
    }
  });

  it("uses the input colour (normalised) as the 500 shade", () => {
    expect(generateShades("#3B82F6")[500]).toBe("#3b82f6");
    expect(generateShades("#3b82f6")[500]).toBe("#3b82f6");
    expect(generateShades("#fff")[500]).toBe("#ffffff");
    expect(generateShades("f59e0b")[500]).toBe("#f59e0b");
  });

  it("has strictly decreasing lightness from 50 to 950", () => {
    for (const input of inputs) {
      const shades = generateShades(input);
      const lights = SHADES.map((s) => lightness(shades[s]));
      for (let i = 1; i < lights.length; i++) {
        expect(lights[i], `${input} ${SHADES[i - 1]} > ${SHADES[i]}`).toBeLessThan(lights[i - 1]);
      }
    }
  });

  it("lightens toward white above 500 and darkens toward black below it", () => {
    const shades = generateShades("#3b82f6");
    expect(lightness(shades[50])).toBeGreaterThan(lightness(shades[500]));
    expect(lightness(shades[950])).toBeLessThan(lightness(shades[500]));
  });

  it("throws on invalid input rather than inventing a colour", () => {
    expect(() => generateShades("not-a-colour")).toThrow();
    expect(() => generateShades("#12345")).toThrow();
  });
});

describe("TAILWIND_FAMILIES and TAILWIND_500", () => {
  it("lists the 22 Tailwind v3 families with official 500 values", () => {
    expect(TAILWIND_FAMILIES).toHaveLength(22);
    for (const family of TAILWIND_FAMILIES) {
      expect(TAILWIND_500[family]).toMatch(HEX_RE);
    }
    expect(TAILWIND_500.blue).toBe("#3b82f6");
    expect(TAILWIND_500.slate).toBe("#64748b");
  });

  it("marks the five neutral families", () => {
    expect(NEUTRAL_FAMILIES).toEqual(["slate", "gray", "zinc", "neutral", "stone"]);
  });
});

describe("scanPaletteUsage", () => {
  it("counts variants and opacity suffixes and sorts by count", () => {
    const usage = scanPaletteUsage({
      "src/App.tsx": `
        <button className="bg-emerald-500 hover:bg-emerald-600 text-white">Go</button>
        <div className="from-violet-600/40 ring-cyan-400/60 dark:bg-emerald-500/50" />
        <p className="text-slate-400 text-slate-400" />
      `,
    });
    expect(usage).toEqual([
      { family: "emerald", count: 3 },
      { family: "slate", count: 2 },
      { family: "cyan", count: 1 },
      { family: "violet", count: 1 },
    ]);
  });

  it("ignores non-family colours and unknown families", () => {
    const usage = scanPaletteUsage({
      "src/a.tsx": 'className="text-white bg-primary-500 bg-black border-transparent text-rose-550"',
    });
    expect(usage).toEqual([]);
  });

  it("reads .ts, .tsx, .js, .jsx and .css only", () => {
    const usage = scanPaletteUsage({
      "a.ts": "bg-sky-500",
      "b.jsx": "bg-sky-500",
      "c.css": ".x { @apply bg-sky-500; }",
      "d.json": '{"c":"bg-sky-500"}',
      "e.md": "bg-sky-500",
    });
    expect(usage).toEqual([{ family: "sky", count: 3 }]);
  });

  it("returns an empty list for no files", () => {
    expect(scanPaletteUsage({})).toEqual([]);
  });
});

describe("scanArbitraryHex", () => {
  it("normalises short and upper-case hex to lowercase 6-digit", () => {
    const usage = scanArbitraryHex({
      "src/a.tsx": 'className="text-[#fff] hover:bg-[#FFF] bg-[#0f172a]"',
    });
    expect(usage).toEqual([
      { hex: "#ffffff", count: 2 },
      { hex: "#0f172a", count: 1 },
    ]);
  });

  it("ignores hex values that are not colour utilities", () => {
    expect(scanArbitraryHex({ "a.tsx": "w-[#fff] content-['#abc']" })).toEqual([]);
  });
});

describe("parseDesign", () => {
  const defaults = JSON.stringify(DEFAULT_DESIGN);

  it("returns defaults for missing, empty or garbage input", () => {
    expect(parseDesign(undefined)).toEqual(DEFAULT_DESIGN);
    expect(parseDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("")).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("{not json")).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("null")).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("[1,2,3]")).toEqual(DEFAULT_DESIGN);
    expect(parseDesign('"a string"')).toEqual(DEFAULT_DESIGN);
    expect(JSON.stringify(parseDesign("garbage"))).toBe(defaults);
  });

  it("fills missing fields in a partial object and recomputes derived fields", () => {
    const d = parseDesign(JSON.stringify({ palette: { sky: "#0284c7" }, tailwind: { junk: true }, fontLinks: ["x"] }));
    expect(d.version).toBe(1);
    expect(d.preset).toBe("custom");
    expect(d.palette).toEqual({ sky: "#0284c7" });
    expect(d.fonts).toEqual({ sans: "System", display: "System" });
    expect(d.radius).toBe(1);
    expect(d.tailwind.darkMode).toBe("class");
    expect(d.tailwind.theme.extend.colors).toBeDefined();
    expect(d.fontLinks).toEqual([]);
  });

  it("drops invalid palette entries and clamps radius", () => {
    const d = parseDesign(
      JSON.stringify({ palette: { blue: "nope", notAFamily: "#123456", rose: "#E11D48" }, radius: 9 }),
    );
    expect(d.palette).toEqual({ rose: "#e11d48" });
    expect(d.radius).toBe(2);
    expect(parseDesign(JSON.stringify({ radius: "abc" })).radius).toBe(1);
  });
});

describe("buildDesign", () => {
  it("builds the default design with no colour, font or radius overrides", () => {
    const d = buildDesign({ preset: "custom", palette: {}, fonts: { sans: "System", display: "System" }, radius: 1 });
    expect(d).toEqual(DEFAULT_DESIGN);
    expect(d.tailwind.theme.extend).not.toHaveProperty("colors");
    expect(d.tailwind.theme.extend).not.toHaveProperty("fontFamily");
    expect(d.tailwind.theme.extend.borderRadius).toEqual({
      sm: "0.125rem",
      DEFAULT: "0.25rem",
      md: "0.375rem",
      lg: "0.5rem",
      xl: "0.75rem",
      "2xl": "1rem",
      "3xl": "1.5rem",
      full: "9999px",
    });
  });

  it("puts generated shades for each overridden family into theme.extend.colors", () => {
    const d = buildDesign({
      preset: "ocean",
      palette: { sky: "#0284C7", blue: "#2563eb" },
      fonts: { sans: "System", display: "System" },
      radius: 1,
    });
    const colors = d.tailwind.theme.extend.colors as Record<string, Record<string, string>>;
    expect(Object.keys(colors)).toEqual(["sky", "blue"]);
    expect(colors.sky[500]).toBe("#0284c7");
    expect(colors.blue).toEqual(generateShades("#2563eb"));
    expect(d.palette).toEqual({ sky: "#0284c7", blue: "#2563eb" });
  });

  it("does not treat a family set to its official 500 as an override", () => {
    const d = buildDesign({
      preset: "custom",
      palette: { slate: TAILWIND_500.slate, rose: "#e11d48" },
      fonts: { sans: "System", display: "System" },
      radius: 1,
    });
    expect(Object.keys(d.palette)).toEqual(["rose"]);
  });

  it("scales the border radius scale by the radius multiplier", () => {
    const d = buildDesign({ preset: "custom", palette: {}, fonts: { sans: "System", display: "System" }, radius: 0.5 });
    const r = d.tailwind.theme.extend.borderRadius as Record<string, string>;
    expect(r.sm).toBe("0.0625rem");
    expect(r.DEFAULT).toBe("0.125rem");
    expect(r.xl).toBe("0.375rem");
    expect(r["3xl"]).toBe("0.75rem");
    expect(r.full).toBe("9999px");
  });

  it("writes font families for non-System choices", () => {
    const d = buildDesign({
      preset: "custom",
      palette: {},
      fonts: { sans: "Plus Jakarta Sans", display: "Playfair Display" },
      radius: 1,
    });
    const ff = d.tailwind.theme.extend.fontFamily as Record<string, string[]>;
    expect(ff.sans).toEqual(FONT_CHOICES.find((f) => f.name === "Plus Jakarta Sans")!.stack);
    expect(ff.display).toEqual(FONT_CHOICES.find((f) => f.name === "Playfair Display")!.stack);
  });

  it("builds the exact Google Fonts css2 URL and dedupes a font used twice", () => {
    const same = buildDesign({
      preset: "custom",
      palette: {},
      fonts: { sans: "Plus Jakarta Sans", display: "Plus Jakarta Sans" },
      radius: 1,
    });
    expect(same.fontLinks).toEqual([
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
    ]);

    const two = buildDesign({
      preset: "custom",
      palette: {},
      fonts: { sans: "DM Sans", display: "Playfair Display" },
      radius: 1,
    });
    expect(two.fontLinks).toEqual([
      "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap",
    ]);
  });

  it("adds no font links for System fonts", () => {
    const d = buildDesign({ preset: "custom", palette: {}, fonts: { sans: "System", display: "System" }, radius: 1 });
    expect(d.fontLinks).toEqual([]);
  });
});

describe("applyPresetToUsage", () => {
  const forest = DESIGN_PRESETS.find((p) => p.id === "forest")!;
  const graphite = DESIGN_PRESETS.find((p) => p.id === "graphite")!;

  it("maps the most-used non-neutral families onto accents in order", () => {
    const mapped = applyPresetToUsage(forest, [
      { family: "rose", count: 10 },
      { family: "sky", count: 7 },
      { family: "amber", count: 2 },
      { family: "violet", count: 1 },
    ]);
    expect(mapped).toEqual({
      rose: "#059669", // forest accent 1 (emerald)
      sky: "#16a34a", // forest accent 2 (green)
      amber: "#0d9488", // forest accent 3 (teal)
    });
  });

  it("maps neutral families to the preset neutral when it has one", () => {
    const mapped = applyPresetToUsage(graphite, [
      { family: "slate", count: 9 },
      { family: "blue", count: 4 },
      { family: "zinc", count: 1 },
    ]);
    expect(mapped).toEqual({
      slate: "#4a5568",
      blue: "#2563eb",
      zinc: "#4a5568",
    });
  });

  it("leaves neutral families alone when the preset has no neutral", () => {
    const mapped = applyPresetToUsage(forest, [
      { family: "slate", count: 9 },
      { family: "emerald", count: 4 },
    ]);
    expect(mapped).toEqual({ emerald: "#059669" });
  });

  it("does not sort the caller's array", () => {
    const used = [
      { family: "rose", count: 1 },
      { family: "sky", count: 5 },
    ];
    applyPresetToUsage(forest, used);
    expect(used[0].family).toBe("rose");
  });
});

describe("DESIGN_PRESETS", () => {
  it("has six presets whose designs build cleanly", () => {
    expect(DESIGN_PRESETS.map((p) => p.id)).toEqual(["ocean", "sunset", "forest", "royal", "graphite", "editorial"]);
    for (const p of DESIGN_PRESETS) {
      const d = buildDesign({ preset: p.id, palette: p.palette, fonts: p.fonts, radius: p.radius });
      expect(d.preset).toBe(p.id);
      expect(Object.keys(d.palette).length).toBeGreaterThan(0);
    }
  });
});

describe("serializeDesign", () => {
  it("round-trips through parseDesign", () => {
    const original = buildDesign({
      preset: "royal",
      palette: { violet: "#7c3aed", indigo: "#4f46e5" },
      fonts: { sans: "Plus Jakarta Sans", display: "Space Grotesk" },
      radius: 1.5,
    });
    const text = serializeDesign(original);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toBe(JSON.stringify(original, null, 2) + "\n");
    expect(parseDesign(text)).toEqual(original);
  });
});
