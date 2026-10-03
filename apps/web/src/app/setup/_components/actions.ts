"use server";

import type { SetupInput } from "@hexmark/shared";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { queueFlashToast } from "@/components/toast/flash-server";
import { isRecord } from "@/lib/api-fields";
import { storeChallenge } from "@/lib/challenge/challenge-store";
import { readChallenge } from "@/lib/challenge/read-challenge";
import { callServer } from "@/lib/server-api";
import { type SetupActionResult, toSetupActionResult } from "./setup-result";

// Server actions of the setup wizard. They forward to the API server, which
// validates everything again; the token and password are never logged here.
// Steps 5 and 6 (two-factor authentication, system settings) have their
// actions in components/two-factor/actions.ts and settings-actions.ts.

// Hashing the password takes a moment; allow more than the default timeout.
const CREATE_ADMIN_TIMEOUT_MS = 15_000;

export async function verifySetupToken(setupToken: string): Promise<SetupActionResult> {
  const response = await callServer("/api/setup/v1/verify-token", {
    method: "POST",
    body: { setupToken: typeof setupToken === "string" ? setupToken : "" },
  });
  return toSetupActionResult(response, 200);
}

const SETUP_FIELDS = [
  "displayName",
  "username",
  "email",
  "password",
  "passwordConfirm",
  "setupToken",
] as const satisfies readonly (keyof SetupInput)[];

export async function createAdmin(input: SetupInput): Promise<SetupActionResult> {
  // Server actions are public endpoints: forward only the known fields, as
  // strings, whatever the caller sent. The API server validates them.
  const body: Record<string, string> = {};
  for (const field of SETUP_FIELDS) {
    const value: unknown = input?.[field];
    body[field] = typeof value === "string" ? value : "";
  }
  // The language the wizard is shown in (cookie from the language step):
  // the admin's locale and the instance default. Taken from the request,
  // not from the caller; the API server checks it like every other field.
  body.locale = await getLocale();
  const response = await callServer("/api/setup/v1/create-first-admin", {
    method: "POST",
    body,
    timeoutMs: CREATE_ADMIN_TIMEOUT_MS,
  });
  const result = toSetupActionResult(response, 201);
  if (!result.ok) return result;
  // The setup ticket for steps 5 and 6 goes into the challenge cookie. Setup
  // is closed now; the page renders again in this request and keeps showing
  // the wizard for this browser (page.tsx), which moves on to step 5.
  const answer = response.reachable && isRecord(response.body) ? response.body : {};
  const ticket = readChallenge(answer.ticket);
  if (!ticket) {
    // Without a ticket the last steps cannot run: on to the completion page.
    await queueFlashToast("adminCreated");
    // redirect() throws; it must stay outside any try/catch.
    redirect("/setup/complete");
  }
  await storeChallenge(ticket);
  return result;
}
