import { systemSettingsInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { sendOutcome } from "../../../lib/outcome";
import { parseJsonBody } from "../../../lib/validation";
import { setupActor } from "../_lib/setup-ticket";
import { saveSystemSettings } from "../_lib/system-settings";

// PUT /api/setup/v1/system-settings – see index.ts for the contract.
export async function putSystemSettings(c: Context): Promise<Response> {
  const actor = setupActor(c);
  if (actor instanceof Response) return actor;
  const body = await parseJsonBody(c, systemSettingsInputSchema);
  if (!body.ok) return body.response;
  const outcome = await saveSystemSettings(actor, body.data, new Date());
  return sendOutcome(c, outcome, (value) => c.json(value, 200));
}
