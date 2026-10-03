import {
  type FieldErrors,
  type IssuedChallenge,
  SECOND_FACTOR_METHODS,
  type SecondFactorMethod,
} from "@hexmark/shared";
import { isRecord, readFieldErrors } from "@/lib/api-fields";
import { readChallenge } from "@/lib/challenge/read-challenge";
import type { ServerResponse } from "@/lib/server-api";
import { readSignedIn, type SignedIn } from "@/lib/session/signed-in";

// The answer of POST /api/auth/v1/login, reduced to what the sign-in flow
// needs (contract: apps/server/src/api/auth/v1/index.ts). A correct password
// ends in one of three ways: signed in; a second factor is required (the
// account has one); or one must be set up first (the instance requires a
// second factor and the account has none). Session and challenge tokens stay
// on the server: the action stores them in their httpOnly cookies and hands
// the browser only what comes next.

export type SignInErrorCode =
  | "validation"
  | "invalid_credentials"
  | "rate_limited"
  // 403: SETUP_TOKEN is still set; the page shows the blocked state.
  | "setup_token_present"
  // 503: INTERNAL_API_KEY or ENCRYPTION_KEY is missing or invalid on the server.
  | "server_not_configured"
  | "database_unavailable"
  | "server_unreachable"
  | "unexpected";

export type EnrolmentMethod = Exclude<SecondFactorMethod, "recovery">;

export type SignInResult =
  | { ok: true; next: "signed_in" }
  // `methods`: what the account can use (or set up) now; may be empty.
  | { ok: true; next: "second_factor"; methods: SecondFactorMethod[] }
  | { ok: true; next: "enrolment"; methods: EnrolmentMethod[] }
  // `fields`: one error code (+ params) per input field (validation).
  | { ok: false; error: SignInErrorCode; fields: FieldErrors };

export type LoginOutcome =
  | ({ kind: "signed_in" } & SignedIn)
  | { kind: "second_factor"; challenge: IssuedChallenge; methods: SecondFactorMethod[] }
  | { kind: "enrolment"; challenge: IssuedChallenge; methods: EnrolmentMethod[] }
  | { kind: "failed"; result: Extract<SignInResult, { ok: false }> };

const KNOWN_ERRORS: Record<string, SignInErrorCode> = {
  validation: "validation",
  invalid_credentials: "invalid_credentials",
  rate_limited: "rate_limited",
  setup_token_present: "setup_token_present",
  server_not_configured: "server_not_configured",
  database_unavailable: "database_unavailable",
};

// Known methods only, each once, in the server's order.
export function readMethods<T extends SecondFactorMethod>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [];
  const known = value.filter((entry): entry is T => allowed.includes(entry));
  return [...new Set(known)];
}

const ENROLMENT_METHODS: readonly EnrolmentMethod[] = ["totp", "webauthn"];

function readContinuation(body: Record<string, unknown>): LoginOutcome | undefined {
  if (body.ok !== false) return undefined;
  const challenge = readChallenge(body.challenge);
  if (!challenge) return undefined;
  if (body.status === "second_factor_required") {
    return {
      kind: "second_factor",
      challenge,
      methods: readMethods(body.methods, SECOND_FACTOR_METHODS),
    };
  }
  if (body.status === "enrolment_required") {
    return { kind: "enrolment", challenge, methods: readMethods(body.methods, ENROLMENT_METHODS) };
  }
  return undefined;
}

export function toLoginOutcome(response: ServerResponse): LoginOutcome {
  const fail = (error: SignInErrorCode, fields: FieldErrors = {}): LoginOutcome => ({
    kind: "failed",
    result: { ok: false, error, fields },
  });
  if (!response.reachable) return fail("server_unreachable");
  const body = isRecord(response.body) ? response.body : {};
  if (response.status === 200) {
    const signedIn = readSignedIn(body);
    if (signedIn) return { kind: "signed_in", ...signedIn };
    return readContinuation(body) ?? fail("unexpected");
  }
  const code = typeof body.error === "string" ? KNOWN_ERRORS[body.error] : undefined;
  return fail(code ?? "unexpected", code === "validation" ? readFieldErrors(body.fields) : {});
}
