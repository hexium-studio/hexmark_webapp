import { reauthenticateInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { failureResponse, sendOutcome } from "../../../lib/outcome";
import { parseJsonBody } from "../../../lib/validation";
import { logRefusedInput } from "../../../services/audit/refused-input";
import { clientAddress } from "../../../services/client-address";
import { sessionFromRequest } from "../../../services/sessions/session-auth";
import { refuse } from "../../../services/two-factor/refusals";
import { unavailable } from "../../../services/two-factor/request-actor";
import { reauthenticate } from "../_lib/reauthenticate";

// POST /api/auth/v1/reauthenticate – see index.ts for the contract.
export async function postReauthenticate(c: Context): Promise<Response> {
  const blocked = unavailable(c);
  if (blocked) return blocked;
  const now = new Date();
  const info = await sessionFromRequest(c, now);
  if (!info) return failureResponse(c, refuse("unauthenticated"));
  const body = await parseJsonBody(c, reauthenticateInputSchema);
  if (!body.ok) {
    // The password field is not summarized (sanitize.ts): only its error code.
    const ref = { kind: "session", sessionId: info.sessionId } as const;
    await logRefusedInput(c, ref, "auth.reauthenticated", body.response, {});
    return body.response;
  }
  const session = { sessionId: info.sessionId, user: info.user };
  const outcome = await reauthenticate(session, body.data.password, clientAddress(c), now);
  return sendOutcome(c, outcome, (value) => c.json(value, 200));
}
