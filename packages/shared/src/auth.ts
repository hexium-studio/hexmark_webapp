import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import type { Locale } from "./locale";
import { emailSchema } from "./setup";
import type { IssuedChallenge, SecondFactorMethod } from "./two-factor";

// Sign-in of human users: the input schema, shared by the server (which
// enforces it) and the web app (which checks the form early), and the shapes
// of the /api/auth/v1 responses. The endpoints are described in
// apps/server/src/api/auth/v1/index.ts.

// Role presets of human accounts.
export const USER_ROLES = ["admin", "user", "guest"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Cookie that holds the session token in the browser (set by the web app).
export const SESSION_COOKIE_NAME = "hexmark_session";

// The web server passes the token to the API as `Authorization: Session <token>`.
export const SESSION_AUTH_SCHEME = "Session";

// A session token: 32 random bytes, base64url without padding.
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const code = (value: FieldErrorCode) => value;

// Body of POST /api/auth/v1/login. The password is not trimmed and has no
// length rules: those apply when a password is set, not when it is entered.
export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string({ error: requiredOr("invalid_type") }).min(1, code("required")),
  // "Remember me": no idle timeout and a persistent cookie.
  remember: z.boolean({ error: requiredOr("invalid_type") }),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

// The signed-in user as the auth endpoints return it.
export interface AuthUser {
  id: string;
  displayName: string;
  username: string;
  role: UserRole;
  locale: Locale;
}

// The session handed out by sign-in. `token` is for the web server only (it
// goes into the httpOnly cookie, never into a response to the browser).
export interface IssuedSession {
  token: string;
  // ISO 8601; the absolute end of the session.
  expiresAt: string;
  remember: boolean;
}

// 200 from POST /api/auth/v1/login and from every step that completes a
// sign-in (second factor, forced enrolment).
export interface SignedInResponse {
  ok: true;
  status: "signed_in";
  user: AuthUser;
  session: IssuedSession;
}

// 200 from POST /api/auth/v1/login when the password was right but the
// account has a second factor: the session is issued only after it
// (POST /api/auth/v1/second-factor/*). `methods` lists what this account can
// use now.
export interface SecondFactorRequiredResponse {
  ok: false;
  status: "second_factor_required";
  challenge: IssuedChallenge;
  methods: SecondFactorMethod[];
}

// 200 from POST /api/auth/v1/login when the instance requires a second factor
// and the account has none: it must add one first
// (POST /api/auth/v1/enrolment/*). `methods`: what can be added here.
export interface EnrolmentRequiredResponse {
  ok: false;
  status: "enrolment_required";
  challenge: IssuedChallenge;
  methods: Exclude<SecondFactorMethod, "recovery">[];
}

export type LoginResponse =
  | SignedInResponse
  | SecondFactorRequiredResponse
  | EnrolmentRequiredResponse;

// 200 from GET /api/auth/v1/me. `rotatedToken` is present when the token was
// replaced during this request: the web server must store it in the cookie;
// the old token keeps working only for a short grace period.
export interface MeResponse {
  user: AuthUser;
  session: {
    rotatedToken?: string;
    expiresAt: string;
    remember: boolean;
  };
}

// `error` values of the auth endpoints besides "validation" (400 with field
// codes), "payload_too_large" (413), "database_unavailable" (503) and
// "internal" (500).
export type AuthErrorCode =
  // 401 from login: e-mail unknown or password wrong (deliberately the same).
  | "invalid_credentials"
  // 401 from me and logout: no token, or no live session for it.
  | "unauthenticated"
  // 403 from every step that would start a session while SETUP_TOKEN is set.
  | "setup_token_present"
  // 503 from the same steps while a required instance key is missing.
  | "server_not_configured"
  // 429 from login after too many failed sign-ins.
  | "rate_limited";
