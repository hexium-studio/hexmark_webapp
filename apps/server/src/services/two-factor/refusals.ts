import type { TwoFactorErrorCode } from "@hexmark/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type Failure, fail } from "../../lib/outcome";

// The HTTP status of every second-factor error code, in one place, so the
// same refusal answers the same way on every endpoint (auth, account, setup).
// The meaning of each code: TwoFactorErrorCode in @hexmark/shared.

const STATUS: Record<TwoFactorErrorCode, ContentfulStatusCode> = {
  challenge_invalid: 401,
  invalid_code: 401,
  webauthn_failed: 401,
  webauthn_registration_failed: 400,
  webauthn_unavailable: 404,
  method_unavailable: 409,
  unauthenticated: 401,
  reauthentication_required: 403,
  invalid_password: 403,
  totp_already_enabled: 409,
  totp_not_pending: 409,
  totp_not_enabled: 404,
  credential_not_found: 404,
  credential_exists: 409,
  last_factor_required: 409,
  second_factor_missing: 409,
  rate_limited: 429,
};

export function refuse(code: TwoFactorErrorCode, details?: Record<string, unknown>): Failure {
  return fail(STATUS[code], code, details);
}
