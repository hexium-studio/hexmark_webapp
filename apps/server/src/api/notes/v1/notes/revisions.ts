import type { Context } from "hono";
import { listRevisions, readRevision } from "../../../../services/notes/history";
import { handle } from "../../_lib/request";

// GET /api/notes/v1/notes/:id/revisions – see ../index.ts for the contract.
export function getRevisions(c: Context): Promise<Response> {
  return handle(c, "read.revisions", null, (ref, _input, now) =>
    listRevisions(ref, now, { id: c.req.param("id") ?? "" }),
  );
}

// GET /api/notes/v1/notes/:id/revisions/:version – see ../index.ts.
export function getRevision(c: Context): Promise<Response> {
  const raw = c.req.param("version") ?? "";
  const version = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  return handle(c, "read.revision", null, async (ref, _input, now) => {
    // No version 0 exists: a malformed one is not_found from the service,
    // which logs the refusal like any other.
    const outcome = await readRevision(ref, now, { id: c.req.param("id") ?? "" }, version ?? 0);
    return outcome.ok ? { ok: true, value: { revision: outcome.value } } : outcome;
  });
}
