import type { Context } from "hono";
import { sendOutcome } from "../../../../lib/outcome";
import { readOverview } from "../../../../services/two-factor/overview";
import { setupActor } from "../../_lib/setup-ticket";

// GET /api/setup/v1/two-factor/status – see ../index.ts for the contract.
export async function getSetupTwoFactorStatus(c: Context): Promise<Response> {
  const actor = setupActor(c);
  if (actor instanceof Response) return actor;
  const outcome = await readOverview(actor, new Date());
  return sendOutcome(c, outcome, ({ overview }) => c.json(overview, 200));
}
