import { restoreNoteInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { restoreNote } from "../../../../services/trash/trash-note";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/notes/:id/restore – see ../index.ts for the contract.
export function postRestoreNote(c: Context): Promise<Response> {
  return handle(
    c,
    "note.restored",
    { body: restoreNoteInputSchema, optional: true },
    (ref, input, now) => restoreNote(ref, now, c.req.param("id") ?? "", input),
  );
}
