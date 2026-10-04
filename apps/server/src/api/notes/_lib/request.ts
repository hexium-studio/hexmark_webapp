import type { AuditAction } from "@hexmark/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { type Outcome, sendOutcome } from "../../../lib/outcome";
import { parseJsonBody, parseQuery, readJsonBody } from "../../../lib/validation";
import type { AccessRef } from "../../../services/access/access";
import { requestAccess } from "../../../services/access/request-access";
import { logRefusedInput } from "../../../services/audit/refused-input";

// The steps every /api/notes/v1 endpoint shares: who is asking (session or
// API token), the checked input, the answer. The operations log what they
// do (services/audit); input refused here, before any operation runs, is
// logged here as a failure of the endpoint's action.

export function noteAccess(c: Context, now: Date): Promise<AccessRef | Response> {
  return requestAccess(c, now, { session: true, bearer: true });
}

// Authenticated request with a checked JSON body or query, then the
// operation; refusals become their status and code.
export async function handle<I, T>(
  c: Context,
  action: AuditAction,
  // optional: the body may be left out (all its fields are optional).
  input: { body: z.ZodType<I>; optional?: boolean } | { query: z.ZodType<I> } | null,
  operation: (ref: AccessRef, data: I, now: Date) => Promise<Outcome<T>>,
  status: 200 | 201 = 200,
): Promise<Response> {
  const now = new Date();
  const ref = await noteAccess(c, now);
  if (ref instanceof Response) return ref;
  let data = undefined as I;
  if (input && "body" in input) {
    const body = await parseJsonBody(c, input.body, input.optional);
    if (!body.ok) {
      await logRefusedInput(c, ref, action, body.response, await readJsonBody(c));
      return body.response;
    }
    data = body.data;
  } else if (input) {
    const query = parseQuery(c, input.query);
    if (!query.ok) {
      await logRefusedInput(c, ref, action, query.response, c.req.query());
      return query.response;
    }
    data = query.data;
  }
  const outcome = await operation(ref, data, now);
  return sendOutcome(c, outcome, (value) => c.json(value as object, status));
}
