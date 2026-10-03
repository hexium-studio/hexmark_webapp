import { recoveryCodeInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { parseJsonBody } from "../../../../lib/validation";
import { checkRecoveryCode, proveSecondFactor } from "../../_lib/second-factor";
import { sendSignIn, signInContext } from "../../_lib/second-factor-request";

// POST /api/auth/v1/second-factor/recovery-code – see ../index.ts.
export async function postSecondFactorRecoveryCode(c: Context): Promise<Response> {
  const context = signInContext(c, new Date());
  if (context instanceof Response) return context;
  const body = await parseJsonBody(c, recoveryCodeInputSchema);
  if (!body.ok) return body.response;
  const check = checkRecoveryCode(body.data.code, context.now);
  return sendSignIn(c, await proveSecondFactor(context, "invalid_code", check));
}
