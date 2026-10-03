"use server";

import type { SetupInput } from "@hexmark/shared";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { queueFlashToast } from "@/components/toast/flash-server";
import { callServer } from "@/lib/server-api";
import { type SetupActionResult, toSetupActionResult } from "./setup-result";

// Server actions of the setup wizard. They forward to the API server, which
// validates everything again; the token and password are never logged here.

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
  if (result.ok) {
    // "Admin account created", shown on the page the redirect leads to.
    await queueFlashToast("adminCreated");
    // redirect() throws; it must stay outside any try/catch.
    redirect("/setup/complete");
  }
  return result;
}
