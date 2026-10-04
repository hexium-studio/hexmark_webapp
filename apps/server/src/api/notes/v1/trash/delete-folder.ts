import type { Context } from "hono";
import { deleteFolderForGood } from "../../../../services/trash/trash-delete";
import { handle } from "../../_lib/request";

// DELETE /api/notes/v1/trash/folders/:id – see ../index.ts for the contract.
// Signed-in people only, decided by the service.
export function deleteTrashedFolder(c: Context): Promise<Response> {
  return handle(c, "folder.deleted_permanently", null, (ref, _input, now) =>
    deleteFolderForGood(ref, now, c.req.param("id") ?? ""),
  );
}
