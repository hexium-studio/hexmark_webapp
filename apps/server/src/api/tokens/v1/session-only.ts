import type { Context } from "hono";
import type { AccessRef } from "../../../services/access/access";
import { requestAccess } from "../../../services/access/request-access";

// Tokens are managed from a signed-in session only: an API token cannot
// create, list or revoke tokens (it gets 401 unauthenticated here).
export function sessionOnly(c: Context, now: Date): Promise<AccessRef | Response> {
  return requestAccess(c, now, { session: true, bearer: false });
}
