import { renameFolderInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { renameFolder } from "../../../../services/notes/folders";
import { handle } from "../../_lib/request";

// PATCH /api/notes/v1/folders/:id – see ../index.ts for the contract.
export function patchFolder(c: Context): Promise<Response> {
  return handle(c, "folder.renamed", { body: renameFolderInputSchema }, (ref, input, now) =>
    renameFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
