import { webauthnRenameInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { sendOutcome } from "../../../../lib/outcome";
import { parseJsonBody } from "../../../../lib/validation";
import { sessionActor } from "../../../../services/two-factor/request-actor";
import { renameKey } from "../../../../services/two-factor/webauthn-keys";

// PATCH /api/account/v1/webauthn/:id – see ../index.ts for the contract.
export async function patchWebauthnKey(c: Context): Promise<Response> {
  const now = new Date();
  const actor = await sessionActor(c, now);
  if (actor instanceof Response) return actor;
  const body = await parseJsonBody(c, webauthnRenameInputSchema);
  if (!body.ok) return body.response;
  const outcome = await renameKey(actor, c.req.param("id") ?? "", body.data.name, now);
  return sendOutcome(c, outcome, (credential) => c.json({ credential }, 200));
}
