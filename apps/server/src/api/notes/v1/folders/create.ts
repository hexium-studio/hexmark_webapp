import { createFolderInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { createFolder } from "../../../../services/notes/folders";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/folders – see ../index.ts for the contract.
export function postFolder(c: Context): Promise<Response> {
  return handle(
    c,
    "folder.created",
    { body: createFolderInputSchema },
    (ref, input, now) => createFolder(ref, now, input),
    201,
  );
}
