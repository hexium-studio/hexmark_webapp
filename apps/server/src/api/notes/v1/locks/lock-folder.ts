import { lockInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { lockFolder, unlockFolder } from "../../../../services/locks/lock-actions";
import { handle } from "../../_lib/request";

// POST /api/notes/v1/folders/:id/lock and /unlock – see ../index.ts for the
// contract. Who may unlock (people only) is decided by the service.
export function postLockFolder(c: Context): Promise<Response> {
  return handle(c, "folder.locked", { body: lockInputSchema, optional: true }, (ref, input, now) =>
    lockFolder(ref, now, c.req.param("id") ?? "", input),
  );
}

export function postUnlockFolder(c: Context): Promise<Response> {
  return handle(
    c,
    "folder.unlocked",
    { body: lockInputSchema, optional: true },
    (ref, input, now) => unlockFolder(ref, now, c.req.param("id") ?? "", input),
  );
}
