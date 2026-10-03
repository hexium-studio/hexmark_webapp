import type { Context } from "hono";
import { sendOutcome } from "../../../../../lib/outcome";
import { signInContext } from "../../../_lib/second-factor-request";
import { authenticationOptions } from "../../../_lib/second-factor-webauthn";

// POST /api/auth/v1/second-factor/webauthn/options – see ../../index.ts.
export async function postSecondFactorWebauthnOptions(c: Context): Promise<Response> {
  const context = signInContext(c, new Date());
  if (context instanceof Response) return context;
  const outcome = await authenticationOptions(context.tokenHash, context.now);
  return sendOutcome(c, outcome, (options) => c.json({ options }, 200));
}
