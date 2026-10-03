import type { FieldErrors, TwoFactorErrorCode } from "@hexmark/shared";
import { isRecord, readFieldErrors } from "@/lib/api-fields";
import type { ServerResponse } from "@/lib/server-api";
import type { BrowserWebauthnError } from "./webauthn-errors";

// Refusals of the second-factor endpoints (sign-in, forced enrolment,
// account page, setup steps 5 and 6) as the browser gets them: a code the
// page translates (messages "twoFactor.errors.<code>"), never a sentence.
// Contract: apps/server/src/api/{auth,account,setup}/v1/index.ts.

export type FactorErrorCode =
  | TwoFactorErrorCode
  | "validation"
  | "setup_token_present"
  | "server_not_configured"
  | "database_unavailable"
  | "server_unreachable"
  | "unexpected";

// Everything a second-factor toast may explain: the server's refusals, the
// browser's part of a WebAuthn ceremony, and "attempts_exhausted" (the last
// wrong answer burnt the sign-in challenge).
export type FactorMessageCode = FactorErrorCode | BrowserWebauthnError | "attempts_exhausted";

export interface FactorFailure {
  ok: false;
  error: FactorErrorCode;
  // Wrong answers left on a sign-in challenge (invalid_code, webauthn_failed).
  attemptsRemaining?: number;
  fields: FieldErrors;
}

const KNOWN: readonly FactorErrorCode[] = [
  "challenge_invalid",
  "invalid_code",
  "webauthn_failed",
  "webauthn_registration_failed",
  "webauthn_unavailable",
  "method_unavailable",
  "unauthenticated",
  "reauthentication_required",
  "invalid_password",
  "totp_already_enabled",
  "totp_not_pending",
  "totp_not_enabled",
  "credential_not_found",
  "credential_exists",
  "last_factor_required",
  "second_factor_missing",
  "rate_limited",
  "validation",
  "setup_token_present",
  "server_not_configured",
  "database_unavailable",
];

export function factorFailure(error: FactorErrorCode): FactorFailure {
  return { ok: false, error, fields: {} };
}

// The refusal in `response`; anything this app does not know is "unexpected".
export function readFactorFailure(response: ServerResponse): FactorFailure {
  if (!response.reachable) return factorFailure("server_unreachable");
  const body = isRecord(response.body) ? response.body : {};
  const code = KNOWN.find((known) => known === body.error) ?? "unexpected";
  const failure: FactorFailure = {
    ok: false,
    error: code,
    fields: code === "validation" ? readFieldErrors(body.fields) : {},
  };
  const left = body.attemptsRemaining;
  if (typeof left === "number" && Number.isInteger(left) && left >= 0) {
    failure.attemptsRemaining = left;
  }
  return failure;
}

// The body of a 200 answer, or undefined for any other answer.
export function okBody(response: ServerResponse): Record<string, unknown> | undefined {
  if (!response.reachable || response.status !== 200) return undefined;
  return isRecord(response.body) ? response.body : undefined;
}

// Recovery codes of an answer that may carry them: a list of strings, or
// null when none were created.
export function readRecoveryCodes(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.every((code) => typeof code === "string") ? (value as string[]) : undefined;
}
