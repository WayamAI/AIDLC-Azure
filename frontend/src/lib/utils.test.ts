import { describe, expect, it } from "vitest";
import { plainFromChatMarkup } from "./utils";

describe("plainFromChatMarkup", () => {
  it("removes emoji codes and emphasis markers but keeps the words and numbers", () => {
    expect(
      plainFromChatMarkup(":warning: *Data Quality Alert* — On *2026-10-11*, *uniqueness* dropped to *85.32* (z-score: -5.16)."),
    ).toBe("Data Quality Alert — On 2026-10-11, uniqueness dropped to 85.32 (z-score: -5.16).");
  });

  it("leaves ordinary text, times and snake_case alone", () => {
    expect(plainFromChatMarkup("Check the user_id column at 10:42:07 UTC")).toBe("Check the user_id column at 10:42:07 UTC");
    expect(plainFromChatMarkup("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});
