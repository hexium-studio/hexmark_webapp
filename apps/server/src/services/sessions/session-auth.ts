import type { Context } from "hono";
import { sessionDurations } from "../../config/session";
import { readSessionToken } from "./session-token";
import { type SessionInfo, useSession } from "./sessions";

// The session of a request to an endpoint for signed-in users
// (`Authorization: Session <token>`), or null. The token is not rotated
// here: only GET /api/auth/v1/me hands a new token to the web server.
export function sessionFromRequest(c: Context, now: Date): Promise<SessionInfo | null> {
  const token = readSessionToken(c.req.header("authorization"));
  return token
    ? useSession(token, now, sessionDurations, { rotate: false })
    : Promise.resolve(null);
}
