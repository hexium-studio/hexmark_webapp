import { verifyTokenInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { guardSetupRequest } from "../_lib/guard";

// POST /api/setup/v1/verify-token: checks the setup token without creating
// anything (step 2 of the wizard). Status codes as in _lib/guard.ts, 200 on success.
export async function verifySetupToken(c: Context): Promise<Response> {
  const guard = await guardSetupRequest(c, verifyTokenInputSchema);
  if (!guard.ok) return guard.response;
  return c.json({ ok: true }, 200);
}
