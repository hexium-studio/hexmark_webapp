import { SESSION_COOKIE_NAME, SESSION_TOKEN_PATTERN } from "@hexmark/shared";

// The session cookie: its options and how a request's value is read. Pure, so
// the proxy (rotation), the sign-in action and the unit tests share one rule.
// The cookie holds the session token; only the Next.js server reads it.

export { SESSION_COOKIE_NAME };

export interface SessionCookieOptions {
  path: "/";
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  // Absent: a browser-session cookie (gone when the browser closes).
  maxAge?: number;
}

export interface SessionCookieInput {
  // "Remember me": a persistent cookie that lives until the session's end.
  remember: boolean;
  // Absolute end of the session as the API reports it (ISO 8601).
  expiresAt: string;
  // Only over HTTPS: instances inside a home network often run on plain
  // HTTP, where a Secure cookie would never be sent back. HTTPS is known
  // only from a trusted proxy (lib/client-origin/request-origin.ts).
  secure: boolean;
  now: Date;
}

// Whole seconds until `expiresAt`, never negative. Rounded down, so the
// browser drops the cookie no later than the server ends the session.
export function secondsUntil(expiresAt: string, now: Date): number {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - now.getTime()) / 1000));
}

export function sessionCookieOptions(input: SessionCookieInput): SessionCookieOptions {
  const base = { path: "/", httpOnly: true, sameSite: "lax", secure: input.secure } as const;
  return input.remember ? { ...base, maxAge: secondsUntil(input.expiresAt, input.now) } : base;
}

// The token of a cookie value, or undefined for an empty or malformed one
// (the API would answer 401 anyway; this saves the call).
export function readSessionToken(value: string | undefined): string | undefined {
  return value && SESSION_TOKEN_PATTERN.test(value) ? value : undefined;
}
