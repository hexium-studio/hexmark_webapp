import { AUDIT_ACTION_CODES, AUDIT_ACTIONS, type AuditActionsListing } from "@hexmark/shared";
import type { Context } from "hono";
import { failureResponse } from "../../../lib/outcome";
import { recordAttemptFailure } from "../../../services/audit/access-events";
import { refuse } from "../../../services/notes/refusals";
import { auditAccess } from "./request";

// GET /api/audit/v1/actions – see index.ts for the contract.
export async function getActions(c: Context): Promise<Response> {
  const ref = await auditAccess(c, new Date());
  if (ref instanceof Response) return ref;
  if (ref.kind !== "session") {
    const refusal = refuse("forbidden", { reason: "session_required" });
    await recordAttemptFailure({ ref, action: "audit.read" }, refusal);
    return failureResponse(c, refusal);
  }
  const listing: AuditActionsListing = {
    actions: AUDIT_ACTION_CODES.map((code) => ({ code, ...AUDIT_ACTIONS[code] })),
  };
  return c.json(listing, 200);
}
