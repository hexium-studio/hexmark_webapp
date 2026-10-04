import { webauthnAuthenticationInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { parseJsonBody } from "../../../../../lib/validation";
import { proveSecondFactor } from "../../../_lib/second-factor";
import { sendSignIn, signInContext } from "../../../_lib/second-factor-request";
import { checkWebauthn } from "../../../_lib/second-factor-webauthn";

// POST /api/auth/v1/second-factor/webauthn/verify – see ../../index.ts.
export async function postSecondFactorWebauthnVerify(c: Context): Promise<Response> {
  const context = signInContext(c, new Date());
  if (context instanceof Response) return context;
  const body = await parseJsonBody(c, webauthnAuthenticationInputSchema);
  if (!body.ok) return body.response;
  const check = checkWebauthn(body.data.response, context.now);
  return sendSignIn(c, await proveSecondFactor(context, "webauthn", "webauthn_failed", check));
}
