import { moveFolderInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { moveFolder } from "../../../../services/notes/folders";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/folders/:id/move – see ../index.ts for the contract.
export function postMoveFolder(c: Context): Promise<Response> {
  return handle(c, "folder.moved", { body: moveFolderInputSchema }, (ref, input, now) =>
    moveFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
