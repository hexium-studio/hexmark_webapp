import type { AuthUser } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { toMeResult } from "@/lib/session/me";
import {
  decodeSessionHeader,
  encodeSessionHeader,
  tokenDigest,
} from "@/lib/session/session-header";

// The request header the proxy hands to pages, and how /me answers are read.

const USER = {
  id: "0b6f6c7e-0000-4000-8000-000000000001",
  displayName: "Zoë Ünal",
  username: "zoe",
  role: "user",
  locale: "de",
} as AuthUser;

describe("session header", () => {
  it("round-trips a signed-in session, any characters in the name", async () => {
    const header = {
      token: await tokenDigest("t".repeat(43)),
      session: { state: "signed-in" as const, user: USER },
    };
    const encoded = encodeSessionHeader(header);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSessionHeader(encoded)).toEqual(header);
  });

  it("round-trips the states without a user", () => {
    for (const state of ["signed-out", "unavailable"] as const) {
      const header = { token: "", session: { state } };
      expect(decodeSessionHeader(encodeSessionHeader(header))).toEqual(header);
    }
  });

  it("rejects missing, garbled or incomplete values", () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(decodeSessionHeader(null)).toBeUndefined();
    expect(decodeSessionHeader("%%%")).toBeUndefined();
    expect(decodeSessionHeader(encode({ session: { state: "signed-out" } }))).toBeUndefined();
    expect(
      decodeSessionHeader(encode({ token: "", session: { state: "signed-in" } })),
    ).toBeUndefined();
    expect(
      decodeSessionHeader(
        encode({ token: "", session: { state: "signed-in", user: { ...USER, role: "root" } } }),
      ),
    ).toBeUndefined();
  });

  it("names the token by its SHA-256 digest, never the token", async () => {
    expect(await tokenDigest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("toMeResult", () => {
  const ok = (body: unknown) => toMeResult({ reachable: true, status: 200, body });
  const session = { expiresAt: "2026-10-31T12:00:00.000Z", remember: false };

  it("reads the user, the session and a rotated token", () => {
    expect(ok({ user: USER, session })).toEqual({ kind: "valid", user: USER, ...session });
    expect(ok({ user: USER, session: { ...session, rotatedToken: "n".repeat(43) } })).toEqual({
      kind: "valid",
      user: USER,
      ...session,
      rotatedToken: "n".repeat(43),
    });
  });

  it("401 means the session is gone; everything else keeps the cookie", () => {
    expect(toMeResult({ reachable: true, status: 401, body: {} })).toEqual({ kind: "invalid" });
    expect(toMeResult({ reachable: false })).toEqual({ kind: "unavailable" });
    for (const status of [500, 503]) {
      expect(toMeResult({ reachable: true, status, body: {} })).toEqual({ kind: "unavailable" });
    }
    expect(ok({ user: { ...USER, role: "root" }, session })).toEqual({ kind: "unavailable" });
    expect(ok({ user: USER })).toEqual({ kind: "unavailable" });
  });
});
