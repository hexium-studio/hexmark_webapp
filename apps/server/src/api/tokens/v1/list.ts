import type { Context } from "hono";
import { sendOutcome } from "../../../lib/outcome";
import { listTokens } from "../../../services/api-tokens/tokens";
import { sessionOnly } from "./session-only";

// GET /api/tokens/v1/tokens – see index.ts for the contract.
export async function getTokens(c: Context): Promise<Response> {
  const now = new Date();
  const ref = await sessionOnly(c, now);
  if (ref instanceof Response) return ref;
  const outcome = await listTokens(ref, now);
  return sendOutcome(c, outcome, (tokens) => c.json({ tokens }, 200));
}
