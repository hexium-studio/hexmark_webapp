import { auditEventsQuerySchema } from "@hexmark/shared";
import type { Context } from "hono";
import { sendOutcome } from "../../../lib/outcome";
import { parseQuery } from "../../../lib/validation";
import { queryAuditEvents } from "../../../services/audit/query";
import { logRefusedInput } from "../../../services/audit/refused-input";
import { auditAccess } from "./request";

// GET /api/audit/v1/events – see index.ts for the contract.
export async function getEvents(c: Context): Promise<Response> {
  const now = new Date();
  const ref = await auditAccess(c, now);
  if (ref instanceof Response) return ref;
  const query = parseQuery(c, auditEventsQuerySchema);
  if (!query.ok) {
    await logRefusedInput(c, ref, "audit.read", query.response, c.req.query());
    return query.response;
  }
  const outcome = await queryAuditEvents(ref, now, query.data);
  return sendOutcome(c, outcome, (page) => c.json(page, 200));
}
