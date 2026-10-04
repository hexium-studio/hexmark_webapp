import { treeQuerySchema } from "@hexmark/shared";
import type { Context } from "hono";
import { listTree } from "../../../services/notes/tree-listing";
import { handle } from "../_lib/request";

// GET /api/notes/v1/tree – see index.ts for the contract.
export function getTree(c: Context): Promise<Response> {
  return handle(c, "read.folder", { query: treeQuerySchema }, (ref, query, now) =>
    listTree(ref, now, { folderId: query.folder ?? null, depth: query.depth }),
  );
}
