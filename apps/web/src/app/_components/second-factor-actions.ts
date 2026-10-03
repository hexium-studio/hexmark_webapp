"use server";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { headers } from "next/headers";
import { isRecord } from "@/lib/api-fields";
import { challengeAuthorization, clearChallenge } from "@/lib/challenge/challenge-store";
import { callServer, type ServerResponse } from "@/lib/server-api";
import { releaseHeldSession, storeSession } from "@/lib/session/session-store";
import { readSignedIn } from "@/lib/session/signed-in";
import {
  type FactorFailure,
  factorFailure,
  okBody,
  readFactorFailure,
} from "@/lib/two-factor/factor-result";

// The second step of a sign-in: the challenge from the password step (in
// the challenge cookie) plus a code, a recovery code or the security key's
// answer. Success stores the session cookie, which makes Next.js render the
// page again as home in the same request. Codes and tokens are never logged.

export type SecondFactorResult = { ok: true } | FactorFailure;

async function send(path: string, body?: unknown): Promise<ServerResponse | undefined> {
  const authorization = await challengeAuthorization();
  if (!authorization) return undefined;
  const userAgent = (await headers()).get("user-agent");
  return callServer(`/api/auth/v1/second-factor/${path}`, {
    method: "POST",
    body,
    // Stored with the session, as at sign-in.
    headers: userAgent ? { authorization, "user-agent": userAgent } : { authorization },
  });
}

async function finish(response: ServerResponse | undefined): Promise<SecondFactorResult> {
  if (!response) return factorFailure("challenge_invalid");
  const body = okBody(response);
  const signedIn = body ? readSignedIn(body) : undefined;
  if (signedIn) {
    await clearChallenge();
    await storeSession(signedIn);
    return { ok: true };
  }
  if (body) return factorFailure("unexpected");
  const failure = readFactorFailure(response);
  // The challenge is gone (expired, used, burnt): so is its cookie.
  if (failure.error === "challenge_invalid" || failure.attemptsRemaining === 0) {
    await clearChallenge();
  }
  return failure;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function verifyTotpCode(code: string): Promise<SecondFactorResult> {
  return finish(await send("totp", { code: text(code) }));
}

export async function verifyRecoveryCode(code: string): Promise<SecondFactorResult> {
  return finish(await send("recovery-code", { code: text(code) }));
}

export type KeySignInOptions =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  | FactorFailure;

export async function securityKeySignInOptions(): Promise<KeySignInOptions> {
  const response = await send("webauthn/options");
  if (!response) return factorFailure("challenge_invalid");
  const body = okBody(response);
  if (!body) return finish(response) as Promise<FactorFailure>;
  if (!isRecord(body.options)) return factorFailure("unexpected");
  return { ok: true, options: body.options as unknown as PublicKeyCredentialRequestOptionsJSON };
}

// `response`: the browser's WebAuthn answer, unchanged.
export async function verifySecurityKey(response: unknown): Promise<SecondFactorResult> {
  return finish(await send("webauthn/verify", { response }));
}

// "Back" from the second step: the pending sign-in is dropped here; on the
// server it runs out on its own.
export async function abandonSignIn(): Promise<void> {
  await clearChallenge();
}

// After a forced enrolment: the codes are saved, the held session starts.
export async function finishEnrolment(): Promise<{ ok: boolean }> {
  return { ok: await releaseHeldSession() };
}
