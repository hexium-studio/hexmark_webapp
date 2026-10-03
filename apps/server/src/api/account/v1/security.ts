import type { AccountSecurityResponse } from "@hexmark/shared";
import type { Context } from "hono";
import { failureResponse } from "../../../lib/outcome";
import {
  isRecentlyReauthenticated,
  reauthenticatedUntil,
} from "../../../services/sessions/reauthentication";
import { readOverview } from "../../../services/two-factor/overview";
import { sessionActor } from "../../../services/two-factor/request-actor";
import { displayTimezone } from "../_lib/display-timezone";

// GET /api/account/v1/security – see index.ts for the contract.
export async function getSecurity(c: Context): Promise<Response> {
  const now = new Date();
  const actor = await sessionActor(c, now);
  if (actor instanceof Response) return actor;
  const outcome = await readOverview(actor, now);
  if (!outcome.ok) return failureResponse(c, outcome);
  const { overview, actor: locked } = outcome.value;
  const recent = isRecentlyReauthenticated(locked.reauthenticatedAt, now);
  const until = recent ? reauthenticatedUntil(locked.reauthenticatedAt) : null;
  const response: AccountSecurityResponse = {
    ...overview,
    reauthenticatedUntil: until?.toISOString() ?? null,
    timezone: await displayTimezone(locked.userId),
  };
  return c.json(response, 200);
}
