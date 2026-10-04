import { deleteFolderInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { trashFolder } from "../../../../services/trash/trash-folder";
import { handle } from "../../_lib/request";

// DELETE /api/notes/v1/folders/:id – see ../index.ts for the contract.
export function deleteFolderEndpoint(c: Context): Promise<Response> {
  return handle(
    c,
    "folder.deleted",
    { body: deleteFolderInputSchema, optional: true },
    (ref, input, now) => trashFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
