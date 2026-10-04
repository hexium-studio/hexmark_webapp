import type { AuditAction } from "@hexmark/shared";
import type { Context } from "hono";
import { fail } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { recordAttemptFailure } from "./access-events";

// A 400 answer to invalid input, given by an endpoint before any operation
// ran (so no service could log it): logged as a failure of the endpoint's
// action, for the signed-in person or token that sent it, with what was
// sent summarized (sanitize.ts) and the field codes.
export async function logRefusedInput(
  c: Context,
  ref: AccessRef,
  action: AuditAction,
  response: Response,
  sent: unknown,
): Promise<void> {
  const answer = (await response.clone().json()) as { error?: string };
  const input = { id: c.req.param("id"), ...(typeof sent === "object" ? sent : {}) };
  const failure = fail(400, answer.error ?? "validation", answer as Record<string, unknown>);
  await recordAttemptFailure({ ref, action, input }, failure);
}
