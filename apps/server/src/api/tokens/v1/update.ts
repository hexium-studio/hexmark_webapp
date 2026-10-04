import { updateApiTokenInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { sendOutcome } from "../../../lib/outcome";
import { parseJsonBody, readJsonBody } from "../../../lib/validation";
import { updateToken } from "../../../services/api-tokens/token-update";
import { logRefusedInput } from "../../../services/audit/refused-input";
import { sessionOnly } from "./session-only";

// PATCH /api/tokens/v1/tokens/:id – see index.ts for the contract.
export async function patchToken(c: Context): Promise<Response> {
  const now = new Date();
  const ref = await sessionOnly(c, now);
  if (ref instanceof Response) return ref;
  const body = await parseJsonBody(c, updateApiTokenInputSchema);
  if (!body.ok) {
    await logRefusedInput(c, ref, "token.updated", body.response, await readJsonBody(c));
    return body.response;
  }
  const outcome = await updateToken(ref, now, c.req.param("id") ?? "", body.data);
  return sendOutcome(c, outcome, (token) => c.json({ token }, 200));
}
