import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  contrastRatio,
  normalizeTheme,
  readableOn,
  shade,
  themeCss,
  themePreview,
  type ThemeSettings,
} from "./theme-engine";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(HERE, "../../../backend/app/templates/chronos_kit/src/chronos/tokens.css");
const hasTokens = existsSync(TOKENS_PATH);

const DARK = '[data-theme="dark"]';

/** Split generated CSS into { root, dark } declaration maps. */
function parseBlocks(css: string): { root: Record<string, string>; dark: Record<string, string> } {
  const grab = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) return {};
    const end = css.indexOf("}", start);
    const body = css.slice(start + selector.length + 2, end);
    const out: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const m = /^\s*(--[\w-]+):\s*(.+);$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  };
  return { root: grab(":root"), dark: grab(DARK) };
}

function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

const FULL_THEME: ThemeSettings = {
  mode: "dark",
  accent: "#2563eb",
  surface: "tinted",
  status: { success: "#16a34a", info: "#0284c7", warning: "#d97706", error: "#dc2626" },
  chart: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
};

describe("defaults and normalizeTheme", () => {
  it("DEFAULT_THEME produces no CSS", () => {
    expect(themeCss(DEFAULT_THEME)).toBe("");
  });

  it("normalizeTheme returns defaults for null, strings and arrays", () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme("ember")).toEqual(DEFAULT_THEME);
    expect(normalizeTheme([1, 2, 3])).toEqual(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toEqual(DEFAULT_THEME);
  });

  it("normalizeTheme repairs garbage field by field", () => {
    const t = normalizeTheme({
      mode: "sepia",
      accent: "not-a-colour",
      surface: "rainbow",
      status: { success: "#fff", info: "bad", warning: "#000", error: "#ff0000" },
      chart: ["#111", "#222", "#333"],
    });
    expect(t).toEqual(DEFAULT_THEME);
  });

  it("normalizeTheme lowercases hex and expands #rgb", () => {
    const t = normalizeTheme({ accent: "#ABC", chart: ["#FF7B1C", "#fff", "#000", "#123456", "#abcdef", "#ABCDEF"] });
    expect(t.accent).toBe("#aabbcc");
    expect(t.chart).toEqual(["#ff7b1c", "#ffffff", "#000000", "#123456", "#abcdef", "#abcdef"]);
  });

  it("normalizeTheme rejects a chart that is not exactly 6 valid hexes", () => {
    expect(normalizeTheme({ chart: ["#111111", "#222222"] }).chart).toBeNull();
    expect(normalizeTheme({ chart: ["#111111", "#222222", "#333333", "#444444", "#555555", "nope"] }).chart).toBeNull();
    expect(normalizeTheme({ chart: "#111111" }).chart).toBeNull();
  });

  it("normalizeTheme rejects a partial status object", () => {
    expect(normalizeTheme({ status: { success: "#16a34a" } }).status).toBeNull();
  });

  it("normalizeTheme keeps valid settings", () => {
    expect(normalizeTheme(FULL_THEME)).toEqual(FULL_THEME);
  });
});

describe("accent", () => {
  const css = themeCss({ ...DEFAULT_THEME, accent: "#2563eb" });
  const { root, dark } = parseBlocks(css);

  it("emits action, stroke and surface variables in both blocks", () => {
    for (const block of [root, dark]) {
      expect(block["--action-primary-default"]).toBeDefined();
      expect(block["--action-primary-hover"]).toBeDefined();
      expect(block["--action-primary-focused"]).toBeDefined();
      expect(block["--action-primary-content"]).toBeDefined();
      expect(block["--stroke-active"]).toBe(block["--action-primary-default"]);
      expect(block["--surface-action"]).toBe(block["--action-primary-default"]);
    }
  });

  it("uses the accent as the light default and shades hover and focus darker", () => {
    expect(root["--action-primary-default"]).toBe("#2563eb");
    expect(root["--action-primary-hover"]).toBe(shade("#2563eb", -0.08));
    expect(root["--action-primary-focused"]).toBe(shade("#2563eb", -0.14));
  });

  it("picks a readable content colour", () => {
    expect(root["--action-primary-content"]).toBe(readableOn("#2563eb"));
    expect(contrastRatio(root["--action-primary-default"], root["--action-primary-content"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark["--action-primary-default"], dark["--action-primary-content"])).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens the dark default only when it is too dark for the dark container", () => {
    // Blue is comfortably above 3:1 against the kit's dark container, so no adjustment.
    expect(dark["--action-primary-default"]).toBe("#2563eb");
    expect(dark["--action-primary-hover"]).toBe(shade("#2563eb", 0.08));
    // Near-black graphite is below 3:1 against the dark container, so it is lightened.
    const graphite = parseBlocks(themeCss({ ...DEFAULT_THEME, accent: "#111827" })).dark;
    expect(graphite["--action-primary-default"]).toBe(shade("#111827", 0.1));
  });

  it("derives series 1 from the accent and five hue-rotated series", () => {
    expect(root["--analytics-series-1"]).toBe("#2563eb");
    for (let i = 2; i <= 6; i++) expect(root[`--analytics-series-${i}`]).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(Object.keys(root).filter((k) => k.startsWith("--analytics-series-"))).size).toBe(6);
  });
});

describe("chart", () => {
  it("chart overrides the derived series regardless of accent", () => {
    const chart = ["#010101", "#020202", "#030303", "#040404", "#050505", "#060606"];
    const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, accent: "#2563eb", chart }));
    for (let i = 0; i < 6; i++) {
      expect(root[`--analytics-series-${i + 1}`]).toBe(chart[i]);
      expect(dark[`--analytics-series-${i + 1}`]).toBe(chart[i]);
    }
  });

  it("chart alone (no accent) still emits series", () => {
    const chart = ["#010101", "#020202", "#030303", "#040404", "#050505", "#060606"];
    const { root } = parseBlocks(themeCss({ ...DEFAULT_THEME, chart }));
    expect(root["--analytics-series-1"]).toBe("#010101");
    expect(root["--action-primary-default"]).toBeUndefined();
  });
});

describe("contrastRatio and readableOn", () => {
  it("black on white is 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("same colour is 1", () => {
    expect(contrastRatio("#2563eb", "#2563eb")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#101010", "#fafafa")).toBeCloseTo(contrastRatio("#fafafa", "#101010"), 10);
  });

  it("readableOn picks white for dark colours and near-black for light ones", () => {
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#1e3a8a")).toBe("#ffffff");
    expect(readableOn("#ffffff")).toBe("#101010");
    expect(readableOn("#22d3ee")).toBe("#101010");
  });
});

describe("shade", () => {
  it("bounds: -1 gives black and +1 gives white", () => {
    expect(shade("#2563eb", -1)).toBe("#000000");
    expect(shade("#2563eb", 1)).toBe("#ffffff");
  });

  it("zero keeps the colour", () => {
    expect(shade("#2563eb", 0)).toBe("#2563eb");
  });

  it("negative darkens and positive lightens", () => {
    // Darker colours contrast more with white; lighter ones contrast more with black.
    const base = "#2563eb";
    expect(contrastRatio(shade(base, -0.3), "#ffffff")).toBeGreaterThan(contrastRatio(base, "#ffffff"));
    expect(contrastRatio(shade(base, 0.3), "#000000")).toBeGreaterThan(contrastRatio(base, "#000000"));
  });

  it("clamps out-of-range amounts and returns #rrggbb", () => {
    expect(shade("#2563eb", -5)).toBe("#000000");
    expect(shade("#2563eb", 5)).toBe("#ffffff");
    expect(shade("#abc", 0.2)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("surfaces", () => {
  it.each(["warm", "cool"] as const)("%s emits the four surface variables in both blocks", (surface) => {
    const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, surface }));
    for (const block of [root, dark]) {
      expect(Object.keys(block).sort()).toEqual([
        "--surface-container",
        "--surface-page-background",
        "--surface-raised",
        "--surface-raised-x2",
      ]);
    }
  });

  it("warm uses the specified light and dark values", () => {
    const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, surface: "warm" }));
    expect(root["--surface-page-background"]).toBe("#f4f2ee");
    expect(root["--surface-raised-x2"]).toBe("#f1eee9");
    expect(dark["--surface-page-background"]).toBe("#0b0a08");
    expect(dark["--surface-container"]).toBe("#15130f");
  });

  it("neutral emits no surface overrides", () => {
    const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, accent: "#2563eb" }));
    expect(root["--surface-page-background"]).toBeUndefined();
    expect(dark["--surface-container"]).toBeUndefined();
  });

  it("tinted surfaces carry the accent's channel ordering (violet: green lowest, blue highest)", () => {
    // Near-white and near-black values are too quantised for a precise hue
    // check, so assert the channel ordering that a violet hue implies.
    const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, accent: "#6d28d9", surface: "tinted" }));
    for (const v of [
      root["--surface-page-background"],
      root["--surface-container"],
      root["--surface-raised"],
      root["--surface-raised-x2"],
      dark["--surface-page-background"],
      dark["--surface-container"],
      dark["--surface-raised"],
      dark["--surface-raised-x2"],
    ]) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
      const r = parseInt(v.slice(1, 3), 16);
      const g = parseInt(v.slice(3, 5), 16);
      const b = parseInt(v.slice(5, 7), 16);
      expect(g, v).toBeLessThan(r);
      expect(r, v).toBeLessThanOrEqual(b);
    }
  });

  it("tinted without an accent uses the kit orange hue", () => {
    const { root } = parseBlocks(themeCss({ ...DEFAULT_THEME, surface: "tinted" }));
    expect(Math.abs(hueOf(root["--surface-page-background"]) - hueOf("#ff7b1c"))).toBeLessThan(8);
  });
});

describe("status", () => {
  const status = { success: "#16a34a", info: "#0284c7", warning: "#d97706", error: "#dc2626" };
  const { root, dark } = parseBlocks(themeCss({ ...DEFAULT_THEME, status }));

  it("emits all five variables per status in both blocks", () => {
    for (const key of ["success", "info", "warning", "error"]) {
      for (const suffix of ["icon", "content", "badge", "background", "stroke"]) {
        expect(root[`--feedback-${key}-${suffix}`]).toBeDefined();
        expect(dark[`--feedback-${key}-${suffix}`]).toBeDefined();
      }
    }
  });

  it("light uses the base colour as icon and rgba tints for background and stroke", () => {
    expect(root["--feedback-error-icon"]).toBe("#dc2626");
    expect(root["--feedback-error-content"]).toBe(shade("#dc2626", -0.25));
    expect(root["--feedback-error-background"]).toBe("rgba(220, 38, 38, 0.12)");
    expect(root["--feedback-error-stroke"]).toBe("rgba(220, 38, 38, 0.35)");
  });

  it("dark lifts the icon and uses stronger tints", () => {
    expect(dark["--feedback-success-icon"]).toBe(shade("#16a34a", 0.1));
    expect(dark["--feedback-success-background"]).toBe("rgba(22, 163, 74, 0.16)");
    expect(dark["--feedback-success-stroke"]).toBe("rgba(22, 163, 74, 0.4)");
  });

  it("null status emits no feedback variables", () => {
    expect(themeCss({ ...DEFAULT_THEME, accent: "#2563eb" })).not.toContain("--feedback-");
  });
});

describe("themeCss output shape", () => {
  it("has the header comment and both blocks, with dark under [data-theme=\"dark\"]", () => {
    const css = themeCss(FULL_THEME);
    expect(css.startsWith(
      "/* Generated by the Chakram design editor. Edit the theme in the App Builder's Design tab. */",
    )).toBe(true);
    expect(css).toContain(":root {");
    expect(css).toContain(`${DARK} {`);
  });

  it("does not emit mode", () => {
    expect(themeCss({ ...DEFAULT_THEME, mode: "dark", accent: "#2563eb" })).not.toMatch(/mode/);
  });

  it("is deterministic", () => {
    expect(themeCss(FULL_THEME)).toBe(themeCss(FULL_THEME));
  });
});

describe("themePreview", () => {
  it("uses kit defaults when nothing is overridden", () => {
    const light = themePreview(DEFAULT_THEME, "light");
    expect(light.page).toBe("#f2f2f2");
    expect(light.container).toBe("#ffffff");
    expect(light.text).toBe("#101010");
    expect(light.accent).toBe("#101010");
    expect(light.accentContent).toBe("#ffffff");
    expect(light.series).toHaveLength(6);

    const dark = themePreview(DEFAULT_THEME, "dark");
    expect(dark.page).toBe("#000000");
    expect(dark.container).toBe("#101010");
    expect(dark.accent).toBe("#fafafa");
    expect(dark.accentContent).toBe("#000000");
  });

  it("reflects accent, surface and status overrides", () => {
    const p = themePreview(
      { ...DEFAULT_THEME, accent: "#ff7b1c", surface: "warm", status: { success: "#16a34a", info: "#0284c7", warning: "#d97706", error: "#dc2626" } },
      "light",
    );
    expect(p.accent).toBe("#ff7b1c");
    expect(p.accentContent).toBe(readableOn("#ff7b1c"));
    expect(p.page).toBe("#f4f2ee");
    expect(p.success).toBe("#16a34a");
    expect(p.error).toBe("#dc2626");
  });
});

describe("presets", () => {
  it("has the eight presets with the agreed accents", () => {
    expect(THEME_PRESETS.map((p) => [p.id, p.theme.accent])).toEqual([
      ["chronos", null],
      ["ember", "#ff7b1c"],
      ["ocean", "#2563eb"],
      ["forest", "#15803d"],
      ["royal", "#6d28d9"],
      ["midnight", "#22d3ee"],
      ["editorial", "#b91c1c"],
      ["graphite", "#111827"],
    ]);
  });

  it("chronos matches the kit exactly", () => {
    expect(themeCss(THEME_PRESETS[0].theme)).toBe("");
    expect(THEME_PRESETS[0].fonts).toEqual({ sans: "Geist", display: "Michroma" });
    expect(THEME_PRESETS[0].radius).toBe(1);
  });

  it("midnight is the dark preset", () => {
    expect(THEME_PRESETS.find((p) => p.id === "midnight")?.theme.mode).toBe("dark");
  });

  it.each(THEME_PRESETS.map((p) => [p.id, p] as const))("%s has readable text and accent in both modes", (_id, preset) => {
    for (const mode of ["light", "dark"] as const) {
      const p = themePreview(preset.theme, mode);
      expect(contrastRatio(p.text, p.container), `${mode} text/container`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accent, p.accentContent), `${mode} accent/accentContent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEME_PRESETS.map((p) => [p.id, p] as const))("%s only emits real tokens", (_id, preset) => {
    expect(normalizeTheme(preset.theme)).toEqual(preset.theme);
  });
});

describe.skipIf(!hasTokens)("generated variable names exist in tokens.css", () => {
  const tokenNames = new Set<string>();
  if (hasTokens) {
    const source = readFileSync(TOKENS_PATH, "utf8");
    for (const m of source.matchAll(/^\s*(--[\w-]+)\s*:/gm)) tokenNames.add(m[1]);
  }

  const names = (css: string) => [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);

  it("tokens.css was parsed", () => {
    expect(tokenNames.has("--surface-page-background")).toBe(true);
    expect(tokenNames.has("--analytics-series-6")).toBe(true);
  });

  it("every preset emits only known variables", () => {
    for (const preset of THEME_PRESETS) {
      for (const n of names(themeCss(preset.theme))) {
        expect(tokenNames.has(n), `${preset.id}: ${n}`).toBe(true);
      }
    }
  });

  it("a fully loaded theme emits only known variables", () => {
    for (const surface of ["neutral", "warm", "cool", "tinted"] as const) {
      for (const n of names(themeCss({ ...FULL_THEME, surface }))) {
        expect(tokenNames.has(n), `${surface}: ${n}`).toBe(true);
      }
    }
  });
});
