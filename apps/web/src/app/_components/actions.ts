"use server";

import { SESSION_AUTH_SCHEME } from "@hexmark/shared";
import { cookies, headers } from "next/headers";
import { storeChallenge } from "@/lib/challenge/challenge-store";
import { callServer } from "@/lib/server-api";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/session/cookie";
import { storeSession } from "@/lib/session/session-store";
import { type SignInValues, validateSignIn } from "./sign-in-form";
import { type SignInResult, toLoginOutcome } from "./sign-in-result";

// Sign-in and sign-out. Both forward to the API server and write the session
// cookie; setting or deleting a cookie makes Next.js render the page again
// in the same request, which then shows home or the sign-in form
// (lib/session/current-session.ts). A sign-in that needs a second factor
// keeps its challenge in the challenge cookie instead; the page stays the
// sign-in page and its client state moves on to the next step. Tokens and
// the password are never logged and never returned to the browser.

// Hashing the password takes a moment; allow more than the default timeout.
const LOGIN_TIMEOUT_MS = 15_000;

export async function signIn(input: SignInValues): Promise<SignInResult> {
  // Server actions are public endpoints: take only the known fields, typed,
  // whatever the caller sent. The API server validates them again.
  const validation = validateSignIn({
    email: typeof input?.email === "string" ? input.email : "",
    password: typeof input?.password === "string" ? input.password : "",
    remember: input?.remember === true,
  });
  if (!validation.ok) return { ok: false, error: "validation", fields: validation.errors };

  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent");
  const response = await callServer("/api/auth/v1/login", {
    method: "POST",
    body: validation.input,
    // Stored with the session, so a later session list can name the device.
    headers: userAgent ? { "user-agent": userAgent } : {},
    timeoutMs: LOGIN_TIMEOUT_MS,
  });
  const outcome = toLoginOutcome(response);
  switch (outcome.kind) {
    case "failed":
      return outcome.result;
    case "signed_in":
      await storeSession(outcome);
      return { ok: true, next: "signed_in" };
    case "second_factor":
    case "enrolment":
      // The password was right; the session follows the next step. A
      // challenge cookie of an earlier attempt is simply replaced.
      await storeChallenge(outcome.challenge);
      return outcome.kind === "second_factor"
        ? { ok: true, next: "second_factor", methods: outcome.methods }
        : { ok: true, next: "enrolment", methods: outcome.methods };
  }
}

export interface SignOutResult {
  // False when the API server could not be asked to end the session (down,
  // server error). The cookie is deleted anyway, and the session ends on its
  // own after its idle timeout or maximum age.
  confirmed: boolean;
}

export async function signOut(): Promise<SignOutResult> {
  const jar = await cookies();
  const token = readSessionToken(jar.get(SESSION_COOKIE_NAME)?.value);
  let confirmed = true;
  if (token) {
    const response = await callServer("/api/auth/v1/logout", {
      method: "POST",
      headers: { authorization: `${SESSION_AUTH_SCHEME} ${token}` },
    });
    // 401: the session had already ended, which is just as good.
    confirmed = response.reachable && (response.status === 200 || response.status === 401);
  }
  jar.delete({ name: SESSION_COOKIE_NAME, path: "/" });
  return { confirmed };
}
