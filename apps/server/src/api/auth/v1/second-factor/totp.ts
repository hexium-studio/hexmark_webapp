import { totpCodeInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { parseJsonBody } from "../../../../lib/validation";
import { checkTotp, proveSecondFactor } from "../../_lib/second-factor";
import { sendSignIn, signInContext } from "../../_lib/second-factor-request";

// POST /api/auth/v1/second-factor/totp – see ../index.ts for the contract.
export async function postSecondFactorTotp(c: Context): Promise<Response> {
  const context = signInContext(c, new Date());
  if (context instanceof Response) return context;
  const body = await parseJsonBody(c, totpCodeInputSchema);
  if (!body.ok) return body.response;
  const check = checkTotp(body.data.code, context.now);
  return sendSignIn(c, await proveSecondFactor(context, "totp", "invalid_code", check));
}
