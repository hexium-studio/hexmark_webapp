import { createHash } from "node:crypto";
import { SESSION_TOKEN_PATTERN } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { AttemptGate } from "../../../apps/server/src/lib/attempt-gate";
import {
  hashSessionToken,
  newSessionToken,
  readSessionToken,
} from "../../../apps/server/src/services/sessions/session-token";

// Session tokens, what the database stores of them, and how the web server
// passes them on. Plus the two-level gate behind the sign-in rate limit.

describe("session tokens", () => {
  it("are 32 random bytes as base64url, different every time", () => {
    const tokens = Array.from({ length: 50 }, () => newSessionToken().token);
    expect(new Set(tokens).size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(SESSION_TOKEN_PATTERN);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("are stored as their SHA-256 digest in lower-case hex, never as themselves", () => {
    const { token, hash } = newSessionToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).not.toContain(token);
  });
});

describe("readSessionToken", () => {
  const token = newSessionToken().token;

  it.each([[`Session ${token}`], [`session ${token}`], [`SESSION   ${token}  `]])(
    "reads %j",
    (header) => {
      expect(readSessionToken(header)).toBe(token);
    },
  );

  it.each([
    ["no header", undefined],
    ["empty", ""],
    ["another scheme", `Bearer ${token}`],
    ["no token", "Session"],
    ["a short token", `Session ${token.slice(1)}`],
    ["a long token", `Session ${token}A`],
    ["characters outside base64url", `Session ${token.slice(1)}=`],
    ["two values", `Session ${token} ${token}`],
  ])("refuses %s", (_, header) => {
    expect(readSessionToken(header)).toBeNull();
  });
});

describe("AttemptGate", () => {
  it("limits per address and across all addresses", () => {
    const gate = new AttemptGate({ perAddress: 2, global: 3, windowMs: 60_000 });
    expect(gate.reserve("a", 0)).not.toBeNull();
    expect(gate.reserve("a", 0)).not.toBeNull();
    expect(gate.reserve("a", 0)).toBeNull();
    expect(gate.reserve("b", 0)).not.toBeNull();
    // Global limit reached; "c" has no attempts of its own.
    expect(gate.reserve("c", 0)).toBeNull();
  });

  it("frees both counters on release, once", () => {
    const gate = new AttemptGate({ perAddress: 1, global: 1, windowMs: 60_000 });
    const attempt = gate.reserve("a", 0);
    attempt?.release();
    attempt?.release();
    expect(gate.reserve("b", 0)).not.toBeNull();
    expect(gate.reserve("a", 0)).toBeNull();
  });
});
