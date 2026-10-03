import { loginInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { getDbStatus } from "../../../db/status";
import { failureResponse } from "../../../lib/outcome";
import { parseJsonBody } from "../../../lib/validation";
import { clientAddress } from "../../../services/client-address";
import { signInRefusalFailure } from "../../../services/sessions/sign-in-policy";
import { login } from "../_lib/login";

// POST /api/auth/v1/login – see index.ts for the contract.
export async function postLogin(c: Context): Promise<Response> {
  if (!getDbStatus().migrated) return c.json({ error: "database_unavailable" }, 503);
  const body = await parseJsonBody(c, loginInputSchema);
  if (!body.ok) return body.response;
  const outcome = await login(body.data, {
    address: clientAddress(c),
    userAgent: c.req.header("user-agent") ?? null,
    now: new Date(),
  });
  switch (outcome.status) {
    case "refused":
      return failureResponse(c, signInRefusalFailure(outcome.reason));
    case "rate_limited":
      return c.json({ error: "rate_limited" }, 429);
    case "invalid_credentials":
      return c.json({ error: "invalid_credentials" }, 401);
    case "answered":
      return c.json(outcome.response, 200);
  }
}
