import type { Context } from "hono";
import { deleteNoteForGood } from "../../../../services/trash/trash-delete";
import { handle } from "../../_lib/request";

// DELETE /api/notes/v1/trash/notes/:id – see ../index.ts for the contract.
// Signed-in people only; the service decides that (an API token is refused
// there with 403), not this endpoint.
export function deleteTrashedNote(c: Context): Promise<Response> {
  return handle(c, "note.deleted_permanently", null, (ref, _input, now) =>
    deleteNoteForGood(ref, now, c.req.param("id") ?? ""),
  );
}
