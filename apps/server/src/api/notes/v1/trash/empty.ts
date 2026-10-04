import type { Context } from "hono";
import { emptyTrash } from "../../../../services/trash/trash-delete";
import { handle } from "../../_lib/request";

// DELETE /api/notes/v1/trash – see ../index.ts for the contract.
// Signed-in administrators only, decided by the service.
export function deleteTrash(c: Context): Promise<Response> {
  return handle(c, "trash.emptied", null, (ref, _input, now) => emptyTrash(ref, now));
}
