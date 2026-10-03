import type { Context } from "hono";
import { getDbStatus } from "../../../db/status";
import { readSessionToken } from "../../../services/sessions/session-token";
import { revokeSession } from "../../../services/sessions/sessions";

// POST /api/auth/v1/logout – see index.ts for the contract.
export async function postLogout(c: Context): Promise<Response> {
  if (!getDbStatus().migrated) return c.json({ error: "database_unavailable" }, 503);
  const token = readSessionToken(c.req.header("authorization"));
  const revoked = token ? await revokeSession(token, new Date()) : false;
  if (!revoked) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ ok: true }, 200);
}
