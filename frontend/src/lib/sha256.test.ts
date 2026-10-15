import { describe, expect, it, vi, afterEach } from "vitest";
import { repoIdFromUrl, sha256Hex, sha256HexFallback } from "./sha256";

describe("sha256HexFallback", () => {
  it("matches the standard vector for 'abc'", () => {
    expect(sha256HexFallback("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches the standard vector for the empty string", () => {
    expect(sha256HexFallback("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("sha256Hex", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the pure-JS fallback when crypto.subtle is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("gives the same output from WebCrypto and the fallback", async () => {
    const message = "https://github.com/acme/widgets";
    const subtleHex = await sha256Hex(message);
    expect(subtleHex).toBe(sha256HexFallback(message));
  });
});

describe("repoIdFromUrl", () => {
  it("normalises the URL and returns a 16-char prefix that is the same on both paths", async () => {
    const id = await repoIdFromUrl("  HTTPS://GitHub.com/Acme/Widgets.git/ ");
    expect(id).toHaveLength(16);
    expect(id).toBe(sha256HexFallback("https://github.com/acme/widgets").slice(0, 16));
  });
});
