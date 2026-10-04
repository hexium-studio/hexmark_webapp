import type { Context } from "hono";
import { sendOutcome } from "../../../lib/outcome";
import { revokeToken } from "../../../services/api-tokens/tokens";
import { sessionOnly } from "./session-only";

// DELETE /api/tokens/v1/tokens/:id – see index.ts for the contract.
export async function deleteToken(c: Context): Promise<Response> {
  const now = new Date();
  const ref = await sessionOnly(c, now);
  if (ref instanceof Response) return ref;
  const outcome = await revokeToken(ref, now, c.req.param("id") ?? "");
  return sendOutcome(c, outcome, (token) => c.json({ token }, 200));
}
