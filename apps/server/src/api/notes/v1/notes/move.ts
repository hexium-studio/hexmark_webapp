import { moveNoteInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { moveNote } from "../../../../services/notes/note-moves";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/notes/:id/move – see ../index.ts for the contract.
export function postMoveNote(c: Context): Promise<Response> {
  return handle(c, "note.moved", { body: moveNoteInputSchema }, (ref, input, now) =>
    moveNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}
