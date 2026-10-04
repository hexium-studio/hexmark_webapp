"use server";

import { isRecord } from "@/lib/api-fields";
import { callServer, type ServerRequest } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import {
  type FactorFailure,
  factorFailure,
  okBody,
  readFactorFailure,
  readRecoveryCodes,
} from "@/lib/two-factor/factor-result";

// Changes on the account security page that are not about adding a factor
// (components/two-factor/actions.ts) or confirming the password
// (components/reauthentication): removing factors, renaming keys and new
// recovery codes. All act with the session cookie.

type Done = { ok: true } | FactorFailure;

async function send(path: string, request: ServerRequest) {
  const authorization = await sessionAuthorization();
  if (!authorization) return undefined;
  return callServer(`/api/account/v1${path}`, {
    ...request,
    headers: { authorization },
  });
}

// Key ids are UUIDs; anything else cannot name a key.
function keyPath(id: unknown): string | undefined {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? `/webauthn/${id}` : undefined;
}

async function done(path: string | undefined, request: ServerRequest): Promise<Done> {
  if (!path) return factorFailure("credential_not_found");
  const response = await send(path, request);
  if (!response) return factorFailure("unauthenticated");
  return okBody(response) ? { ok: true } : readFactorFailure(response);
}

export async function removeAuthenticator(): Promise<Done> {
  return done("/totp", { method: "DELETE" });
}

export async function removeSecurityKey(id: string): Promise<Done> {
  return done(keyPath(id), { method: "DELETE" });
}

export async function renameSecurityKey(id: string, name: string): Promise<Done> {
  return done(keyPath(id), {
    method: "PATCH",
    body: { name: typeof name === "string" ? name : "" },
  });
}

export type RegenerateResult = { ok: true; recoveryCodes: string[] } | FactorFailure;

export async function regenerateRecoveryCodes(): Promise<RegenerateResult> {
  const response = await send("/recovery-codes/regenerate", { method: "POST" });
  if (!response) return factorFailure("unauthenticated");
  const body = okBody(response);
  if (!body) return readFactorFailure(response);
  const codes = readRecoveryCodes(isRecord(body) ? body.recoveryCodes : undefined);
  return codes ? { ok: true, recoveryCodes: codes } : factorFailure("unexpected");
}
