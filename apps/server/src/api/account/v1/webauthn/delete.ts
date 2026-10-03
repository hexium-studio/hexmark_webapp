import type { Context } from "hono";
import { sendOutcome } from "../../../../lib/outcome";
import { sessionActor } from "../../../../services/two-factor/request-actor";
import { removeKey } from "../../../../services/two-factor/webauthn-keys";

// DELETE /api/account/v1/webauthn/:id – see ../index.ts for the contract.
export async function deleteWebauthnKey(c: Context): Promise<Response> {
  const now = new Date();
  const actor = await sessionActor(c, now);
  if (actor instanceof Response) return actor;
  const outcome = await removeKey(actor, c.req.param("id") ?? "", now);
  return sendOutcome(c, outcome, (value) => c.json(value, 200));
}
