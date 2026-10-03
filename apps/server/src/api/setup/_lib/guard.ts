import type { Context } from "hono";
import type { z } from "zod";
import { clientAddress } from "../../../lib/client-address";
import { invalidBodyError, readJsonBody, zodValidationError } from "../../../lib/validation";
import { reserveSetupAttempt } from "./setup-attempts";
import { isDatabaseMigrated, isSetupOpen } from "./setup-state";
import { getSetupTokenState, matchesSetupToken } from "./setup-token";

// Checks shared by every request that presents the setup token
// (POST /api/setup/v1/verify-token and /api/setup/v1/create-first-admin), in
// this order: rate limit (429), database ready (503), setup open (404), token
// configured (503), body valid (400), token correct (401). Only a wrong token counts as a
// failed attempt. "Setup open" is a snapshot here; creating the admin decides
// it again under a lock (create-first-admin.ts).

export type GuardResult<T> = { ok: true; data: T } | { ok: false; response: Response };

type Outcome<T> = { data: T } | { response: Response; failedAttempt: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function evaluate<T extends { setupToken: string }>(
  c: Context,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<Outcome<T>> {
  const refuse = (response: Response) => ({ response, failedAttempt: false });
  if (!isDatabaseMigrated()) return refuse(c.json({ error: "database_unavailable" }, 503));
  let open: boolean;
  try {
    open = await isSetupOpen();
  } catch {
    return refuse(c.json({ error: "database_unavailable" }, 503));
  }
  if (!open) return refuse(c.json({ error: "not_found" }, 404));
  if (!getSetupTokenState().configured) {
    return refuse(c.json({ error: "setup_token_not_configured" }, 503));
  }
  if (!isPlainObject(body)) {
    return refuse(c.json(invalidBodyError(), 400));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return refuse(c.json(zodValidationError(parsed.error), 400));
  if (!matchesSetupToken(parsed.data.setupToken)) {
    return { response: c.json({ error: "invalid_token" }, 401), failedAttempt: true };
  }
  return { data: parsed.data };
}

export async function guardSetupRequest<T extends { setupToken: string }>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<GuardResult<T>> {
  const body = await readJsonBody(c);
  // Reserved before the first await below, so parallel requests are counted.
  const attempt = reserveSetupAttempt(clientAddress(c));
  if (!attempt) return { ok: false, response: c.json({ error: "rate_limited" }, 429) };
  let outcome: Outcome<T>;
  try {
    outcome = await evaluate(c, schema, body);
  } catch (error) {
    attempt.release();
    throw error;
  }
  if ("data" in outcome) {
    attempt.release();
    return { ok: true, data: outcome.data };
  }
  if (!outcome.failedAttempt) attempt.release();
  return { ok: false, response: outcome.response };
}
