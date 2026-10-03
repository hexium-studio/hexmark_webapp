import { CHALLENGE_COOKIE_NAME, CHALLENGE_TOKEN_PATTERN } from "@hexmark/shared";
import { secondsUntil } from "@/lib/session/cookie";

// The challenge cookie: holds the token of a sign-in that still needs its
// second factor (5 minutes), of a forced enrolment (15 minutes) or the setup
// enrolment ticket of the wizard's last steps (15 minutes). Like the session
// cookie it is httpOnly: only the Next.js server reads it and passes the
// token on as `Authorization: Challenge <token>`. Pure, for the actions and
// the unit tests alike.

export { CHALLENGE_COOKIE_NAME };

export interface ChallengeCookieOptions {
  path: "/";
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
}

// Lives exactly as long as the server accepts the token. `secure` follows
// the same rule as the session cookie (lib/client-origin/request-origin.ts).
export function challengeCookieOptions(
  expiresAt: string,
  secure: boolean,
  now: Date,
): ChallengeCookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: secondsUntil(expiresAt, now),
  };
}

// The token of a cookie value, or undefined for an empty or malformed one.
export function readChallengeToken(value: string | undefined): string | undefined {
  return value && CHALLENGE_TOKEN_PATTERN.test(value) ? value : undefined;
}
