import type { Context } from "hono";
import { failureResponse } from "../../lib/outcome";
import { readApiToken } from "../api-tokens/token-format";
import { refuse } from "../notes/refusals";
import { sessionFromRequest } from "../sessions/session-auth";
import { readSessionToken } from "../sessions/session-token";
import { unavailable } from "../two-factor/request-actor";
import type { AccessRef } from "./access";
import { authenticateBearer } from "./bearer";

// Who a request acts for, from its Authorization header: a human's session
// (`Session <token>`, sent by the web server) or an agent's API token
// (`Bearer hmk_...`). This is the check at the door for a quick 401; every
// operation decides again on the locked row (access.ts, authorize.ts).

export interface AccessOptions {
  session: boolean;
  bearer: boolean;
  // Where a token request came in, for the audit log (default: the HTTP API).
  via?: "http" | "mcp";
}

export async function requestAccess(
  c: Context,
  now: Date,
  allowed: AccessOptions,
): Promise<AccessRef | Response> {
  const blocked = unavailable(c);
  if (blocked) return blocked;
  const header = c.req.header("authorization");
  if (allowed.session && readSessionToken(header)) {
    const info = await sessionFromRequest(c, now);
    if (info) return { kind: "session", sessionId: info.sessionId };
  } else if (allowed.bearer) {
    const token = readApiToken(header);
    if (token) {
      const outcome = await authenticateBearer(token, now, allowed.via ?? "http");
      return "kind" in outcome ? outcome : failureResponse(c, outcome);
    }
  }
  return failureResponse(c, refuse("unauthenticated"));
}
