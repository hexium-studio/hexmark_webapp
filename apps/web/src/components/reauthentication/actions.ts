"use server";

import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { factorFailure, okBody, readFactorFailure } from "@/lib/two-factor/factor-result";
import type { ReauthenticateResult } from "./recent";

// POST /api/auth/v1/reauthenticate: sensitive actions (account security,
// creating an API token) are allowed for the next 10 minutes. The password
// is never logged.
export async function reauthenticate(password: string): Promise<ReauthenticateResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return factorFailure("unauthenticated");
  const response = await callServer("/api/auth/v1/reauthenticate", {
    method: "POST",
    headers: { authorization },
    body: { password: typeof password === "string" ? password : "" },
  });
  const body = okBody(response);
  if (!body) return readFactorFailure(response);
  const until = body.reauthenticatedUntil;
  return typeof until === "string" ? { ok: true, until } : factorFailure("unexpected");
}
