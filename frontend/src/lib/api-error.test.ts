import { describe, expect, it } from "vitest";
import { apiErrorMessage, detailToText, NETWORK_ERROR_MESSAGE, statusFallback } from "./api-error";

describe("detailToText", () => {
  it("passes a string through", () => {
    expect(detailToText("  Jira is not configured.  ")).toBe("Jira is not configured.");
  });

  it("flattens FastAPI validation errors and names the field", () => {
    const detail = [
      { loc: ["body", "password"], msg: "String should have at least 10 characters", type: "string_too_short" },
      { loc: ["body", "email"], msg: "Value error, Enter a valid email address", type: "value_error" },
    ];
    expect(detailToText(detail)).toBe("Password must be at least 10 characters. Enter a valid email address");
    expect(detailToText([{ loc: ["body", "target_url"], msg: "Field required" }])).toBe("Target url is required");
    expect(detailToText([{ loc: ["query", "limit"], msg: "Input should be less than or equal to 500" }])).toBe(
      "Limit must be at most 500",
    );
    expect(detailToText([{ loc: ["body", "x"], msg: "Something unusual happened" }])).toBe("X: something unusual happened");
  });

  it("reads a message out of an object and never returns [object Object]", () => {
    expect(detailToText({ message: "Rate limited until 10:42" })).toBe("Rate limited until 10:42");
    expect(detailToText({ code: 7 })).toBe("");
    expect(detailToText(null)).toBe("");
  });
});

describe("apiErrorMessage", () => {
  it("prefers the server's message", () => {
    expect(apiErrorMessage({ response: { status: 503, data: { detail: "GitHub is not configured." } } })).toBe(
      "GitHub is not configured.",
    );
  });

  it("falls back to the caller's text, then to the status code", () => {
    expect(apiErrorMessage({ response: { status: 500, data: "<html>" } }, "Could not load runs.")).toBe(
      "Could not load runs.",
    );
    expect(apiErrorMessage({ response: { status: 429, data: {} } })).toBe(statusFallback(429));
    expect(apiErrorMessage({ response: { status: 410, data: null } })).toMatch(/expired/);
  });

  it("explains a network failure instead of echoing axios", () => {
    expect(apiErrorMessage({ code: "ERR_NETWORK", message: "Network Error" })).toBe(NETWORK_ERROR_MESSAGE);
    expect(apiErrorMessage({ message: "Request failed with status code 500" })).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("keeps a plain Error's message", () => {
    expect(apiErrorMessage(new Error("File is larger than 2 MB"))).toBe("File is larger than 2 MB");
  });
});
