import {
  instanceKeyState,
  internalKeyMatches,
  normalizeIpAddress,
  parseInstanceKey,
  readInternalKey,
} from "@hexmark/shared/internal-calls";
import { describe, expect, it } from "vitest";

// The instance key format (INTERNAL_API_KEY, ENCRYPTION_KEY), the key
// comparison and the canonical form of client addresses, shared by the web
// server and the API server.

const KEY = Buffer.alloc(32, 7).toString("base64url");

describe("parseInstanceKey", () => {
  it("accepts 32 bytes as 43 base64url characters, with surrounding spaces", () => {
    expect(KEY).toHaveLength(43);
    expect(parseInstanceKey(KEY)).toEqual(Buffer.alloc(32, 7));
    expect(parseInstanceKey(`  ${KEY}\n`)).toEqual(Buffer.alloc(32, 7));
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", KEY.slice(1)],
    ["too long", `${KEY}A`],
    ["padded base64", `${Buffer.alloc(32, 7).toString("base64")}`],
    ["plus and slash", Buffer.alloc(32, 0xfb).toString("base64").replace(/=+$/, "")],
    ["hex", Buffer.alloc(32, 7).toString("hex")],
    ["space inside", `${KEY.slice(0, 20)} ${KEY.slice(21)}`],
    // Same bytes, but the unused low bits of the last character are set.
    ["non-canonical last character", `${KEY.slice(0, 42)}${KEY.at(-1) === "w" ? "x" : "B"}`],
  ])("rejects %s", (_name, value) => {
    expect(parseInstanceKey(value)).toBeNull();
  });

  it("reports missing, invalid and valid", () => {
    expect(instanceKeyState(undefined)).toBe("missing");
    expect(instanceKeyState("   ")).toBe("missing");
    expect(instanceKeyState("short")).toBe("invalid");
    expect(instanceKeyState(KEY)).toBe("valid");
  });

  it("reads INTERNAL_API_KEY only when valid, trimmed", () => {
    expect(readInternalKey({ INTERNAL_API_KEY: ` ${KEY} ` })).toBe(KEY);
    expect(readInternalKey({ INTERNAL_API_KEY: "too-short" })).toBeNull();
    expect(readInternalKey({})).toBeNull();
  });
});

describe("internalKeyMatches", () => {
  it("matches only the exact key", () => {
    expect(internalKeyMatches(KEY, KEY)).toBe(true);
    expect(internalKeyMatches(`${KEY.slice(0, 42)}B`, KEY)).toBe(false);
    expect(internalKeyMatches("", KEY)).toBe(false);
    expect(internalKeyMatches(`${KEY}x`, KEY)).toBe(false);
    expect(internalKeyMatches(undefined, KEY)).toBe(false);
  });
});

describe("normalizeIpAddress", () => {
  it.each([
    ["192.0.2.1", "192.0.2.1"],
    [" 192.0.2.1 ", "192.0.2.1"],
    ["192.0.2.1:8080", "192.0.2.1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["::FFFF:192.0.2.1", "192.0.2.1"],
    ["2001:DB8::1", "2001:db8::1"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["fe80::1%eth0", "fe80::1"],
    ["::1", "::1"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeIpAddress(raw)).toBe(expected);
  });

  it.each([
    "",
    "unknown",
    "example.com",
    "256.0.0.1",
    "192.0.2",
    "192.0.2.1/24",
    "[2001:db8::1",
    "2001:db8::1]:443",
    "1.2.3.4, 5.6.7.8",
    `1${"0".repeat(80)}`,
  ])("rejects %j", (raw) => {
    expect(normalizeIpAddress(raw)).toBeUndefined();
  });

  it("rejects null and undefined", () => {
    expect(normalizeIpAddress(null)).toBeUndefined();
    expect(normalizeIpAddress(undefined)).toBeUndefined();
  });
});
