import { restoreFolderInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { restoreFolder } from "../../../../services/trash/trash-restore-folder";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/folders/:id/restore – see ../index.ts for the contract.
export function postRestoreFolder(c: Context): Promise<Response> {
  return handle(
    c,
    "folder.restored",
    { body: restoreFolderInputSchema, optional: true },
    (ref, input, now) => restoreFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
