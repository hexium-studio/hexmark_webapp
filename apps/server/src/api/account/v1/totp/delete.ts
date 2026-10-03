import type { Context } from "hono";
import { sendOutcome } from "../../../../lib/outcome";
import { sessionActor } from "../../../../services/two-factor/request-actor";
import { removeTotp } from "../../../../services/two-factor/totp-factor";

// DELETE /api/account/v1/totp – see ../index.ts for the contract.
export async function deleteTotp(c: Context): Promise<Response> {
  const now = new Date();
  const actor = await sessionActor(c, now);
  if (actor instanceof Response) return actor;
  return sendOutcome(c, await removeTotp(actor, now), (value) => c.json(value, 200));
}
