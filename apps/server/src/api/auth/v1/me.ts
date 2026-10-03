import type { MeResponse } from "@hexmark/shared";
import type { Context } from "hono";
import { getDbStatus } from "../../../db/status";
import { readSessionToken } from "../../../services/sessions/session-token";
import { useSession } from "../../../services/sessions/sessions";

// GET /api/auth/v1/me – see index.ts for the contract.
export async function getMe(c: Context): Promise<Response> {
  if (!getDbStatus().migrated) return c.json({ error: "database_unavailable" }, 503);
  const token = readSessionToken(c.req.header("authorization"));
  const info = token ? await useSession(token, new Date()) : null;
  if (!info) return c.json({ error: "unauthenticated" }, 401);
  const { rotatedToken, expiresAt, remember } = info.session;
  const response: MeResponse = {
    user: info.user,
    session: {
      ...(rotatedToken ? { rotatedToken } : {}),
      expiresAt: expiresAt.toISOString(),
      remember,
    },
  };
  return c.json(response, 200);
}
