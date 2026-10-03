import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_DURATIONS as D } from "../../../apps/server/src/config/session";
import {
  evaluateSessionUse,
  type SessionTimes,
} from "../../../apps/server/src/services/sessions/session-rules";

// When a session is valid and what using it changes. The clock is injected:
// every case states the session's times and "now" explicitly.

const MIN = 60_000;
const SIGN_IN = Date.parse("2026-01-01T12:00:00Z");
const at = (offsetMs: number) => new Date(SIGN_IN + offsetMs);

function session(overrides: Partial<SessionTimes> = {}): SessionTimes {
  return {
    remember: false,
    lastSeenAt: at(0),
    rotatedAt: at(0),
    expiresAt: at(D.maxAgeMs),
    revokedAt: null,
    previousValidUntil: null,
    ...overrides,
  };
}

const use = (s: SessionTimes, nowOffset: number, match: "current" | "previous" = "current") =>
  evaluateSessionUse(s, match, at(nowOffset), D);

describe("validity", () => {
  it("is valid right after sign-in, without writing anything", () => {
    expect(use(session(), 1_000)).toEqual({ valid: true, rotate: false, touch: false });
  });

  it("is invalid once revoked", () => {
    expect(use(session({ revokedAt: at(500) }), 1_000)).toEqual({ valid: false });
  });

  it("without remember me: valid until just before the idle timeout", () => {
    expect(use(session(), D.idleTimeoutMs - 1).valid).toBe(true);
    expect(use(session(), D.idleTimeoutMs)).toEqual({ valid: false });
  });

  it("idle time counts from the last recorded use, not from sign-in", () => {
    const s = session({ lastSeenAt: at(10 * D.idleTimeoutMs) });
    expect(use(s, 10 * D.idleTimeoutMs + D.idleTimeoutMs - 1).valid).toBe(true);
  });

  it("with remember me: no idle limit", () => {
    const s = session({ remember: true });
    expect(use(s, D.idleTimeoutMs * 24).valid).toBe(true);
  });

  it("with or without remember me: invalid from expiresAt on", () => {
    for (const remember of [true, false]) {
      const s = session({ remember, lastSeenAt: at(D.maxAgeMs - MIN) });
      expect(use(s, D.maxAgeMs - 1).valid).toBe(true);
      expect(use(s, D.maxAgeMs)).toEqual({ valid: false });
    }
  });
});

describe("last_seen_at", () => {
  it("is written at most once per minute", () => {
    expect(use(session(), MIN - 1)).toEqual({ valid: true, rotate: false, touch: false });
    expect(use(session(), MIN)).toEqual({ valid: true, rotate: false, touch: true });
  });
});

describe("rotation", () => {
  it("is due once the rotation interval has passed since the last rotation", () => {
    const s = session({ lastSeenAt: at(D.rotationMs - MIN) });
    expect(use(s, D.rotationMs - 1)).toMatchObject({ valid: true, rotate: false });
    expect(use(s, D.rotationMs)).toEqual({ valid: true, rotate: true, touch: true });
  });

  it("counts from rotated_at, not from sign-in", () => {
    const s = session({ rotatedAt: at(D.rotationMs), lastSeenAt: at(D.rotationMs) });
    expect(use(s, D.rotationMs + D.rotationMs - 1)).toMatchObject({ valid: true, rotate: false });
    expect(use(s, 2 * D.rotationMs)).toMatchObject({ valid: true, rotate: true });
  });

  it("never happens on an invalid session", () => {
    const s = session({ lastSeenAt: at(0) });
    expect(use(s, D.idleTimeoutMs + D.rotationMs)).toEqual({ valid: false });
  });
});

describe("previous token after a rotation", () => {
  const rotated = session({
    rotatedAt: at(10 * MIN),
    lastSeenAt: at(10 * MIN),
    previousValidUntil: at(10 * MIN + 30_000),
  });

  it("works until the grace period ends, and does not rotate again", () => {
    expect(use(rotated, 10 * MIN + 29_999, "previous")).toEqual({
      valid: true,
      rotate: false,
      touch: false,
    });
    expect(use(rotated, 10 * MIN + 30_000, "previous")).toEqual({ valid: false });
  });

  it("does not rotate even when the rotation interval has passed", () => {
    const late = { ...rotated, previousValidUntil: at(10 * MIN + D.rotationMs + 30_000) };
    expect(use(late, 10 * MIN + D.rotationMs, "previous")).toMatchObject({
      valid: true,
      rotate: false,
    });
  });

  it("is refused when the session has no previous token", () => {
    expect(use(session(), 1_000, "previous")).toEqual({ valid: false });
  });

  it("is refused once the session is revoked, even within the grace period", () => {
    expect(use({ ...rotated, revokedAt: at(10 * MIN + 1) }, 10 * MIN + 2, "previous")).toEqual({
      valid: false,
    });
  });
});
