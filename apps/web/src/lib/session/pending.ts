import { readSessionToken, secondsUntil } from "./cookie";
import type { SignedIn } from "./signed-in";

// The cookie that holds a session between the end of a forced enrolment and
// the moment the user has saved the recovery codes (session-store.ts).
// httpOnly like the session cookie; short-lived, because the user is looking
// at the codes right now. Pure, for the unit tests.

export const PENDING_SESSION_COOKIE = "hexmark_pending_session";
const PENDING_MAX_AGE_SECONDS = 15 * 60;

export function encodePendingSession({ session, locale }: SignedIn): string {
  return Buffer.from(JSON.stringify({ ...session, locale }), "utf8").toString("base64url");
}

export function readPendingSession(value: string | undefined): SignedIn | undefined {
  if (!value) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const { token, expiresAt, remember, locale } = data as Record<string, unknown>;
  const valid = readSessionToken(typeof token === "string" ? token : undefined);
  if (!valid || typeof expiresAt !== "string" || typeof remember !== "boolean") return undefined;
  const session = { token: valid, expiresAt, remember };
  return typeof locale === "string" ? { session, locale } : { session };
}

export function pendingSessionOptions(signedIn: SignedIn, secure: boolean, now: Date) {
  const maxAge = Math.min(PENDING_MAX_AGE_SECONDS, secondsUntil(signedIn.session.expiresAt, now));
  return {
    name: PENDING_SESSION_COOKIE,
    value: encodePendingSession(signedIn),
    options: { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge } as const,
  };
}
