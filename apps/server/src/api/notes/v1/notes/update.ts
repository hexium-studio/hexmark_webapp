import { updateNoteInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { updateNote } from "../../../../services/notes/note-edits";
import { handle } from "../../_lib/request";

// PATCH /api/notes/v1/notes/:id – see ../index.ts for the contract.
export function patchNote(c: Context): Promise<Response> {
  return handle(c, "note.updated", { body: updateNoteInputSchema }, (ref, input, now) =>
    updateNote(ref, now, { id: c.req.param("id") ?? "" }, input),
  );
}
