import type { Context } from "hono";
import { listHidden } from "../../../../services/hidden/hidden-list";
import { handle } from "../../_lib/request";

// GET /api/notes/v1/hidden – see ../index.ts for the contract.
export function getHidden(c: Context): Promise<Response> {
  return handle(c, "read.hidden", null, (ref, _input, now) => listHidden(ref, now));
}
