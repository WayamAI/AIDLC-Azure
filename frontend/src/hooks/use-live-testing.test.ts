import { describe, expect, it } from "vitest";
import type { PlaywrightTestCase } from "@/lib/api";
import { injectCredentialsForRun, injectCredentialsIntoTests, isLocalAnalysis } from "./use-live-testing";

const step = (action: string, selector: string, value = "", description = "") =>
  ({ action, selector, value, description }) as PlaywrightTestCase["steps"][number];

const test = (id: string, source: string | undefined, steps: PlaywrightTestCase["steps"]) =>
  ({ id, name: id, description: "", page_name: "/", severity: "High", steps, ...(source ? { source } : {}) }) as unknown as PlaywrightTestCase;

describe("injectCredentialsIntoTests", () => {
  it("fills login fields and leaves other steps alone", () => {
    const [out] = injectCredentialsIntoTests(
      [test("t", undefined, [step("fill", "#email"), step("fill", "#password"), step("fill", "#search", "shoes"), step("click", "#password")])],
      "qa@example.com",
      "s3cret-value",
    );
    expect(out.steps.map((s) => s.value)).toEqual(["qa@example.com", "s3cret-value", "shoes", ""]);
  });

  it("returns the tests untouched when no credentials are given", () => {
    const tests = [test("t", undefined, [step("fill", "#email", "x")])];
    expect(injectCredentialsIntoTests(tests)).toBe(tests);
  });
});

describe("injectCredentialsForRun", () => {
  it("signs baseline tests in and does not rewrite session tests", () => {
    const session = test("s", "session", [step("fill", "#password", "deliberately-wrong")]);
    const baseline = test("b", "baseline", [step("fill", "input[name=email]"), step("fill", "input[name=password]")]);
    const [s, b] = injectCredentialsForRun([session, baseline], "qa@example.com", "s3cret-value");
    expect(s).toBe(session);
    expect(b.steps.map((x) => x.value)).toEqual(["qa@example.com", "s3cret-value"]);
  });

  it("is a no-op without credentials", () => {
    const tests = [test("b", "baseline", [step("fill", "#email")])];
    expect(injectCredentialsForRun(tests)).toBe(tests);
  });
});

describe("isLocalAnalysis", () => {
  it("sends handed-off, uploaded and direct tests to the direct endpoint", () => {
    for (const id of ["workspace-handoff", "spec-1712", "direct-9", "baseline"]) expect(isLocalAnalysis(id)).toBe(true);
  });

  it("leaves stored analyses on the analysis endpoint", () => {
    expect(isLocalAnalysis("6acdcb0e9f1b2c3d4e5f6a7b")).toBe(false);
  });
});
