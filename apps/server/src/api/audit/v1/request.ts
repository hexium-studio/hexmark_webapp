import type { Context } from "hono";
import type { AccessRef } from "../../../services/access/access";
import { requestAccess } from "../../../services/access/request-access";

// Who asks: a signed-in person (the web app). API tokens are let through
// the door so they get 403 forbidden { reason: "session_required" } (and
// the refusal is logged as audit.read) rather than a bare 401.
export function auditAccess(c: Context, now: Date): Promise<AccessRef | Response> {
  return requestAccess(c, now, { session: true, bearer: true });
}
