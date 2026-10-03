import type { Context } from "hono";
import { sendOutcome } from "../../../../lib/outcome";
import { regenerateRecoveryCodes } from "../../../../services/two-factor/recovery-actions";
import { sessionActor } from "../../../../services/two-factor/request-actor";

// POST /api/account/v1/recovery-codes/regenerate – see ../index.ts.
export async function postRegenerateRecoveryCodes(c: Context): Promise<Response> {
  const now = new Date();
  const actor = await sessionActor(c, now);
  if (actor instanceof Response) return actor;
  return sendOutcome(c, await regenerateRecoveryCodes(actor, now), (value) => c.json(value, 200));
}
