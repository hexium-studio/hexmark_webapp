import { trashQuerySchema } from "@hexmark/shared";
import type { Context } from "hono";
import { listTrash } from "../../../../services/trash/trash-list";
import { handle } from "../../_lib/request";

// GET /api/notes/v1/trash – see ../index.ts for the contract.
export function getTrash(c: Context): Promise<Response> {
  return handle(c, "read.trash", { query: trashQuerySchema }, (ref, query, now) =>
    listTrash(ref, now, { folderId: query.folder ?? null, limit: query.limit }),
  );
}
