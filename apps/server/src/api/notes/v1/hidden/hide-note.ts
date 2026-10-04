import { hideInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { hideNote, unhideNote } from "../../../../services/hidden/hide-actions";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/notes/:id/hide and /unhide – see ../index.ts for the
// contract. Who may unhide (people only, recently re-authenticated) is
// decided by the service.
export function postHideNote(c: Context): Promise<Response> {
  return handle(c, "note.hidden", { body: hideInputSchema, optional: true }, (ref, input, now) =>
    hideNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}

export function postUnhideNote(c: Context): Promise<Response> {
  return handle(c, "note.unhidden", { body: hideInputSchema, optional: true }, (ref, input, now) =>
    unhideNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}
