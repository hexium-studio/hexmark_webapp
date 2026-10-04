import { lockInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { lockNote, unlockNote } from "../../../../services/locks/lock-actions";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/notes/:id/lock and /unlock – see ../index.ts for the
// contract. Who may unlock (people only) is decided by the service.
export function postLockNote(c: Context): Promise<Response> {
  return handle(c, "note.locked", { body: lockInputSchema, optional: true }, (ref, input, now) =>
    lockNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}

export function postUnlockNote(c: Context): Promise<Response> {
  return handle(c, "note.unlocked", { body: lockInputSchema, optional: true }, (ref, input, now) =>
    unlockNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}
