import { describe, expect, it } from "vitest";
import { asUtcIso, markServerDatesUtc } from "./server-dates";

describe("asUtcIso", () => {
  it("marks an offset-less timestamp as UTC", () => {
    expect(asUtcIso("2026-10-13T07:25:00")).toBe("2026-10-13T07:25:00Z");
    expect(asUtcIso("2026-10-13T07:25:00.123456")).toBe("2026-10-13T07:25:00.123456Z");
    expect(new Date(asUtcIso("2026-10-13T07:25:00")).toISOString()).toBe("2026-10-13T07:25:00.000Z");
  });

  it("leaves timestamps that already carry an offset, dates and other text alone", () => {
    for (const value of ["2026-10-13T07:25:00Z", "2026-10-13T07:25:00+00:00", "2026-10-13", "Tue", "", "see 2026-10-13T07:25:00 in the log"]) {
      expect(asUtcIso(value)).toBe(value);
    }
  });
});

describe("markServerDatesUtc", () => {
  it("marks timestamp-named fields in nested records", () => {
    const payload = {
      started_at: "2026-10-13T07:25:00.5",
      completed_at: null,
      total: 3,
      runs: [{ timestamp: "2026-10-12T23:59:59", name: "TC-001", created: "2026-10-12T00:00:00" }],
      timeline: [{ time: "2026-10-11T00:00:00", event: "Incident created" }],
    };
    markServerDatesUtc(payload);
    expect(payload.started_at).toBe("2026-10-13T07:25:00.5Z");
    expect(payload.runs[0]).toEqual({ timestamp: "2026-10-12T23:59:59Z", name: "TC-001", created: "2026-10-12T00:00:00Z" });
    expect(payload.timeline[0].time).toBe("2026-10-11T00:00:00Z");
    expect(payload.completed_at).toBeNull();
  });

  it("never rewrites user or generated content", () => {
    const payload = {
      generated_at: "2026-10-13T07:25:00",
      // A synthetic dataset: these strings are the data, not our timestamps.
      rows: [{ attempt_timestamp: "2026-01-01T09:00:00", created_at: "2026-01-01T09:00:00" }],
      series: [{ date: "2026-09-14T00:00:00", overall: 91 }],
      name: "2026-10-13T07:25:00",
      description: "ran at 2026-10-13T07:25:00",
    };
    markServerDatesUtc(payload);
    expect(payload.generated_at).toBe("2026-10-13T07:25:00Z");
    expect(payload.rows[0]).toEqual({ attempt_timestamp: "2026-01-01T09:00:00", created_at: "2026-01-01T09:00:00" });
    expect(payload.series[0].date).toBe("2026-09-14T00:00:00");
    expect(payload.name).toBe("2026-10-13T07:25:00");
  });

  it("does not touch non-JSON values", () => {
    const blob = new Blob(["2026-10-13T07:25:00"]);
    expect(markServerDatesUtc(blob)).toBe(blob);
    expect(markServerDatesUtc(null)).toBeNull();
    expect(markServerDatesUtc(7)).toBe(7);
  });
});
