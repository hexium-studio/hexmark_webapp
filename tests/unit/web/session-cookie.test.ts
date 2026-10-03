import { describe, expect, it } from "vitest";
import { readSessionToken, secondsUntil, sessionCookieOptions } from "@/lib/session/cookie";

// Options of the session cookie: browser-session cookie without "remember
// me", Max-Age until the session's end with it, Secure only over HTTPS.

const NOW = new Date("2026-10-03T12:00:00.000Z");
const IN_28_DAYS = "2026-10-31T12:00:00.000Z";

describe("sessionCookieOptions", () => {
  it("without remember me: a browser-session cookie (no Max-Age)", () => {
    const options = sessionCookieOptions({
      remember: false,
      expiresAt: IN_28_DAYS,
      secure: false,
      now: NOW,
    });
    expect(options).toEqual({ path: "/", httpOnly: true, sameSite: "lax", secure: false });
    expect("maxAge" in options).toBe(false);
  });

  it("with remember me: Max-Age is the time left until expiresAt", () => {
    const options = sessionCookieOptions({
      remember: true,
      expiresAt: IN_28_DAYS,
      secure: true,
      now: NOW,
    });
    expect(options).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 28 * 24 * 60 * 60,
    });
  });

  it("after a rotation late in the session the cookie gets only the rest", () => {
    const options = sessionCookieOptions({
      remember: true,
      expiresAt: "2026-10-03T12:05:00.500Z",
      secure: false,
      now: NOW,
    });
    expect(options.maxAge).toBe(300);
  });
});

describe("secondsUntil", () => {
  it("rounds down, so the cookie never outlives the session", () => {
    expect(secondsUntil("2026-10-03T12:00:01.999Z", NOW)).toBe(1);
  });

  it("is never negative, and 0 for an unreadable date", () => {
    expect(secondsUntil("2026-10-03T11:00:00.000Z", NOW)).toBe(0);
    expect(secondsUntil("not a date", NOW)).toBe(0);
  });
});

describe("readSessionToken", () => {
  it("accepts a 43-character base64url token only", () => {
    const token = "abcDEF123_-".padEnd(43, "x");
    expect(readSessionToken(token)).toBe(token);
    expect(readSessionToken(undefined)).toBeUndefined();
    expect(readSessionToken("")).toBeUndefined();
    expect(readSessionToken(`${token}x`)).toBeUndefined();
    expect(readSessionToken("a b".padEnd(43, "x"))).toBeUndefined();
  });
});
