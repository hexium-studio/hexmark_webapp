import { hideInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { hideFolder, unhideFolder } from "../../../../services/hidden/hide-actions";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/folders/:id/hide and /unhide – see ../index.ts for the
// contract. Who may unhide (people only, recently re-authenticated) is
// decided by the service.
export function postHideFolder(c: Context): Promise<Response> {
  return handle(c, "folder.hidden", { body: hideInputSchema, optional: true }, (ref, input, now) =>
    hideFolder(ref, now, c.req.param("id") ?? "", input),
  );
}

export function postUnhideFolder(c: Context): Promise<Response> {
  return handle(
    c,
    "folder.unhidden",
    { body: hideInputSchema, optional: true },
    (ref, input, now) => unhideFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
