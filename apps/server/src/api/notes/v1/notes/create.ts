import { createNoteInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { createNote } from "../../../../services/notes/note-create";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/notes – see ../index.ts for the contract.
export function postNote(c: Context): Promise<Response> {
  return handle(
    c,
    "note.created",
    { body: createNoteInputSchema },
    (ref, input, now) => createNote(ref, now, input),
    201,
  );
}
