import { changesQuerySchema } from "@hexmark/shared";
import type { Context } from "hono";
import { listChanges } from "../../../services/notes/history";
import { handle } from "../_lib/request";

// GET /api/notes/v1/changes – see index.ts for the contract.
export function getChanges(c: Context): Promise<Response> {
  return handle(c, "read.changes", { query: changesQuerySchema }, async (ref, query, now) => {
    const outcome = await listChanges(ref, now, query);
    return outcome.ok ? { ok: true, value: { changes: outcome.value } } : outcome;
  });
}
