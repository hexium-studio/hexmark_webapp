import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import { recoveryCodeSchema } from "./recovery-code";
import { timezoneSchema } from "./timezone";

// Second factors (authenticator app = TOTP, security keys = WebAuthn) and
// recovery codes: input schemas shared by the server (which enforces them)
// and the web app, plus the shapes of the responses. The endpoints are
// described in apps/server/src/api/{auth,account,setup,instance}/v1/index.ts.

// Cookie in which the web app keeps a challenge or setup ticket token.
export const CHALLENGE_COOKIE_NAME = "hexmark_challenge";

// The web server passes such a token as `Authorization: Challenge <token>`.
export const CHALLENGE_AUTH_SCHEME = "Challenge";

// A challenge token: 32 random bytes, base64url without padding.
export const CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const SECOND_FACTOR_METHODS = ["totp", "webauthn", "recovery"] as const;
export type SecondFactorMethod = (typeof SECOND_FACTOR_METHODS)[number];

export const TOTP_DIGITS = 6;

const code = (value: FieldErrorCode) => value;

// A code from an authenticator app. Spaces are ignored ("123 456").
export const totpCodeSchema = z
  .string({ error: requiredOr("invalid_type") })
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => value !== "", { message: code("required") })
  .refine((value) => value === "" || new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(value), {
    message: code("invalid_format"),
    params: { length: TOTP_DIGITS },
  });

export const totpCodeInputSchema = z.object({ code: totpCodeSchema });
export const recoveryCodeInputSchema = z.object({ code: recoveryCodeSchema });

export const WEBAUTHN_NAME_LIMITS = { min: 1, max: 64 } as const;

// The name a user gives a security key.
export const webauthnNameSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(WEBAUTHN_NAME_LIMITS.min, code("required"))
  .max(WEBAUTHN_NAME_LIMITS.max, code("too_long"));

// The browser's answer to a WebAuthn ceremony (the JSON form of a
// PublicKeyCredential, e.g. from @simplewebauthn/browser). Only its outline
// is checked here; the server verifies the content.
export const webauthnResponseSchema = z.looseObject({
  id: z.string({ error: requiredOr("invalid_type") }).min(1, code("required")),
  rawId: z.string({ error: requiredOr("invalid_type") }).min(1, code("required")),
  type: z.literal("public-key", { error: code("invalid") }),
  response: z.record(z.string(), z.unknown(), { error: code("invalid") }),
});

export type WebauthnResponseJson = z.infer<typeof webauthnResponseSchema>;

export const webauthnAuthenticationInputSchema = z.object({ response: webauthnResponseSchema });
export const webauthnRegistrationInputSchema = z.object({
  name: webauthnNameSchema,
  response: webauthnResponseSchema,
});
export const webauthnRenameInputSchema = z.object({ name: webauthnNameSchema });

// Body of POST /api/auth/v1/reauthenticate.
export const reauthenticateInputSchema = z.object({
  password: z.string({ error: requiredOr("invalid_type") }).min(1, code("required")),
});

// Body of PUT /api/setup/v1/system-settings.
export const systemSettingsInputSchema = z.object({
  timezone: timezoneSchema,
  requireTwoFactor: z.boolean({ error: requiredOr("invalid_type") }),
});

export type SystemSettingsInput = z.infer<typeof systemSettingsInputSchema>;

// A challenge or ticket as handed to the web server (token for the cookie only).
export interface IssuedChallenge {
  token: string;
  // ISO 8601.
  expiresAt: string;
}

export interface WebauthnCredentialSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: "singleDevice" | "multiDevice" | null;
  backedUp: boolean;
}

// The factors of one account (account security page, setup step 5).
export interface TwoFactorOverview {
  totp: { enabled: boolean };
  webauthn: { available: boolean; credentials: WebauthnCredentialSummary[] };
  recoveryCodes: { remaining: number };
  // The instance requires a second factor for every account.
  requireTwoFactor: boolean;
}

// 200 from GET /api/account/v1/security. `reauthenticatedUntil`: until when
// sensitive actions are allowed without entering the password again (ISO
// 8601), or null when the password must be entered first. `timezone`: the
// IANA zone the account's dates are shown in (its own, else the instance
// default).
export interface AccountSecurityResponse extends TwoFactorOverview {
  reauthenticatedUntil: string | null;
  timezone: string;
}

// How many second factors an account has. The rules below decide what the
// server allows and what the web app offers, so both apply the same rule.
export interface FactorCounts {
  totp: boolean;
  webauthn: number;
}

export function hasAnyFactor(counts: FactorCounts): boolean {
  return counts.totp || counts.webauthn > 0;
}

export function factorCounts(overview: TwoFactorOverview): FactorCounts {
  return { totp: overview.totp.enabled, webauthn: overview.webauthn.credentials.length };
}

// Whether a factor may be removed, given what would be left: while the
// instance requires a second factor, the last one stays.
export function mayRemoveFactor(requireTwoFactor: boolean, after: FactorCounts): boolean {
  return !requireTwoFactor || hasAnyFactor(after);
}

// 200 from a totp/start endpoint: what the authenticator app needs. The web
// app renders `otpauthUri` as a QR code and shows `secret` for manual entry.
export interface TotpStartResponse {
  secret: string;
  otpauthUri: string;
}

// Recovery codes are returned once, when they are created: with the first
// factor of an account and on regeneration. Null when none were created.
export interface FactorAddedResponse {
  ok: true;
  recoveryCodes: string[] | null;
}

// `error` values of the second-factor endpoints besides "validation",
// "payload_too_large", "database_unavailable" and "internal".
export type TwoFactorErrorCode =
  // 401: the challenge or ticket is unknown, expired, used up or burnt.
  | "challenge_invalid"
  // 401: wrong code; `attemptsRemaining` tells how many tries the challenge
  // has left (0: it is burnt, sign in again).
  | "invalid_code"
  // 401 at sign-in, with `attemptsRemaining`: the security key's answer did
  // not verify.
  | "webauthn_failed"
  // 400: registering the security key failed (answer did not verify, or
  // the ceremony expired); start again with new options.
  | "webauthn_registration_failed"
  // 404: security keys are not offered (PUBLIC_ORIGIN not set).
  | "webauthn_unavailable"
  // 409: the account has no factor of that kind at sign-in.
  | "method_unavailable"
  // 401 from account endpoints: no live session.
  | "unauthenticated"
  // 403: re-enter the password first (POST /api/auth/v1/reauthenticate).
  | "reauthentication_required"
  // 403 from reauthenticate: wrong password.
  | "invalid_password"
  | "totp_already_enabled"
  | "totp_not_pending"
  | "totp_not_enabled"
  | "credential_not_found"
  | "credential_exists"
  // 409: the instance requires a second factor; the last one stays.
  | "last_factor_required"
  // 409: the action needs a second factor on the account first.
  | "second_factor_missing"
  | "rate_limited";

// 200 from GET /api/instance/v1/capabilities.
export interface InstanceCapabilities {
  // Security keys and passkeys are offered (PUBLIC_ORIGIN is configured).
  webauthn: boolean;
}
