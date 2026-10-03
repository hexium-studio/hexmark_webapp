import { SESSION_LAST_SEEN_INTERVAL_MS, type SessionDurations } from "../../config/session";

// When a session may be used, and what using it changes. Pure: the caller
// passes the session row and the time, so the rules can be checked without a
// database or a clock. sessions.ts applies them to the row it holds locked.

export interface SessionTimes {
  remember: boolean;
  lastSeenAt: Date;
  rotatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  previousValidUntil: Date | null;
}

// Which of the session's tokens was presented: the current one, or the one
// it replaced at the last rotation.
export type TokenMatch = "current" | "previous";

export type SessionUse =
  | { valid: false }
  | {
      valid: true;
      // Replace the token now (only when the current token was presented).
      rotate: boolean;
      // Write last_seen_at (a rotation always does).
      touch: boolean;
    };

// A session is valid while it is not revoked, its absolute end has not
// passed, and – without "remember me" – it was used within the idle timeout.
// The previous token additionally works only until its grace period ends.
export function evaluateSessionUse(
  session: SessionTimes,
  match: TokenMatch,
  now: Date,
  durations: SessionDurations,
): SessionUse {
  const at = now.getTime();
  if (session.revokedAt !== null) return { valid: false };
  if (at >= session.expiresAt.getTime()) return { valid: false };
  const idleMs = at - session.lastSeenAt.getTime();
  if (!session.remember && idleMs >= durations.idleTimeoutMs) return { valid: false };
  if (match === "previous") {
    const graceEnd = session.previousValidUntil?.getTime();
    if (graceEnd === undefined || at >= graceEnd) return { valid: false };
  }
  // A request with the previous token raced the rotation; the session already
  // has a newer token, so it is not replaced again.
  const rotate = match === "current" && at - session.rotatedAt.getTime() >= durations.rotationMs;
  const touch = rotate || idleMs >= SESSION_LAST_SEEN_INTERVAL_MS;
  return { valid: true, rotate, touch };
}
