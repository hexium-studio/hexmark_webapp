import type { Context } from "hono";
import { listLocked } from "../../../../services/locks/locked-list";
import { handle } from "../../_lib/request";

// GET /api/notes/v1/locked – see ../index.ts for the contract.
export function getLocked(c: Context): Promise<Response> {
  return handle(c, "read.locked", null, (ref, _input, now) => listLocked(ref, now));
}
