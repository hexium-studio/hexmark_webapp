"use server";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { isRecord } from "@/lib/api-fields";
import { challengeAuthorization, clearChallenge } from "@/lib/challenge/challenge-store";
import { callServer, type ServerRequest } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { holdSession } from "@/lib/session/session-store";
import { readSignedIn } from "@/lib/session/signed-in";
import {
  type FactorFailure,
  factorFailure,
  okBody,
  readFactorFailure,
  readRecoveryCodes,
} from "@/lib/two-factor/factor-result";
import { type QrSvg, qrCodeSvg } from "@/lib/two-factor/qr-code";
import { FACTOR_CONTEXTS, type FactorContext } from "./factor-context";

// Adding a second factor, the same four calls in three places: the account
// page (session cookie), forced enrolment at sign-in and setup step 5 (both
// with the challenge cookie). Each place has its own URL prefix and
// credentials; operations and answers are the same
// (apps/server/src/services/two-factor/endpoints.ts). Secrets and tokens are
// never logged; the authenticator secret goes to the browser once, for
// showing it.

const PREFIX: Record<FactorContext, string> = {
  account: "/api/account/v1",
  enrolment: "/api/auth/v1/enrolment",
  setup: "/api/setup/v1/two-factor",
};

async function call(context: unknown, path: string, body?: unknown) {
  if (!FACTOR_CONTEXTS.includes(context as FactorContext)) return undefined;
  const known = context as FactorContext;
  const authorization =
    known === "account" ? await sessionAuthorization() : await challengeAuthorization();
  const request: ServerRequest = { method: "POST", body };
  if (authorization) request.headers = { authorization };
  return { context: known, response: await callServer(`${PREFIX[known]}${path}`, request) };
}

export type TotpStartResult = { ok: true; secret: string; qr: QrSvg } | FactorFailure;

export async function startTotp(context: FactorContext): Promise<TotpStartResult> {
  const result = await call(context, "/totp/start");
  if (!result) return factorFailure("unexpected");
  const body = okBody(result.response);
  if (!body) return readFactorFailure(result.response);
  const { secret, otpauthUri } = body;
  if (typeof secret !== "string" || typeof otpauthUri !== "string") {
    return factorFailure("unexpected");
  }
  return { ok: true, secret, qr: qrCodeSvg(otpauthUri) };
}

// `recoveryCodes`: shown once, when this was the account's first factor.
export type FactorAddedResult = { ok: true; recoveryCodes: string[] | null } | FactorFailure;

// The answer to confirm (TOTP) or verify (security key). Forced enrolment
// also starts the session; it is held until the codes are saved.
async function factorAdded(
  context: FactorContext,
  response: Awaited<ReturnType<typeof callServer>>,
): Promise<FactorAddedResult> {
  const body = okBody(response);
  if (!body) return readFactorFailure(response);
  const recoveryCodes = readRecoveryCodes(body.recoveryCodes);
  if (recoveryCodes === undefined) return factorFailure("unexpected");
  if (context === "enrolment") {
    const signedIn = readSignedIn(body);
    if (!signedIn) return factorFailure("unexpected");
    await holdSession(signedIn);
    await clearChallenge();
  }
  return { ok: true, recoveryCodes };
}

export async function confirmTotp(
  context: FactorContext,
  code: string,
): Promise<FactorAddedResult> {
  const result = await call(context, "/totp/confirm", {
    code: typeof code === "string" ? code : "",
  });
  if (!result) return factorFailure("unexpected");
  return factorAdded(result.context, result.response);
}

export type KeyOptionsResult =
  | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
  | FactorFailure;

export async function securityKeyOptions(context: FactorContext): Promise<KeyOptionsResult> {
  const result = await call(context, "/webauthn/registration/options");
  if (!result) return factorFailure("unexpected");
  const body = okBody(result.response);
  if (!body) return readFactorFailure(result.response);
  if (!isRecord(body.options)) return factorFailure("unexpected");
  // Passed to the browser's WebAuthn API as the server made it.
  return { ok: true, options: body.options as unknown as PublicKeyCredentialCreationOptionsJSON };
}

// `response`: what the browser's WebAuthn API answered, unchanged; the API
// server checks it.
export async function registerSecurityKey(
  context: FactorContext,
  name: string,
  response: unknown,
): Promise<FactorAddedResult> {
  const result = await call(context, "/webauthn/registration/verify", {
    name: typeof name === "string" ? name : "",
    response,
  });
  if (!result) return factorFailure("unexpected");
  return factorAdded(result.context, result.response);
}
