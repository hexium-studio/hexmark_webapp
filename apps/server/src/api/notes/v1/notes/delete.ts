import { deleteNoteInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { trashNote } from "../../../../services/trash/trash-note";
import { handle } from "../../_lib/request";

// DELETE /api/notes/v1/notes/:id – see ../index.ts for the contract.
export function deleteNote(c: Context): Promise<Response> {
  return handle(c, "note.deleted", { body: deleteNoteInputSchema }, (ref, input, now) =>
    trashNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}
