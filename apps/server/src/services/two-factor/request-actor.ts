import type { AuditAction } from "@hexmark/shared";
import type { Context } from "hono";
import { serverNotConfigured } from "../../config/secrets";
import { getDbStatus } from "../../db/status";
import { failureResponse } from "../../lib/outcome";
import { logRefusedInput } from "../audit/refused-input";
import { sessionFromRequest } from "../sessions/session-auth";
import type { ActorRef } from "./actor";
import { challengeTokenHash, readChallengeToken } from "./challenges";
import { refuse } from "./refusals";

// Who a request to a second-factor endpoint acts for, from its
// Authorization header. These are first checks for a quick answer; the
// operations check the session or challenge again on its locked row
// (actor.ts).

// 503 while the database is not migrated or an instance key is missing:
// factors cannot be read or sealed then.
export function unavailable(c: Context): Response | null {
  if (!getDbStatus().migrated) return c.json({ error: "database_unavailable" }, 503);
  if (serverNotConfigured()) return c.json({ error: "server_not_configured" }, 503);
  return null;
}

// `Authorization: Session <token>` of a live session, else 401 unauthenticated.
export async function sessionActor(c: Context, now: Date): Promise<ActorRef | Response> {
  const blocked = unavailable(c);
  if (blocked) return blocked;
  const info = await sessionFromRequest(c, now);
  if (!info) return failureResponse(c, refuse("unauthenticated"));
  return { kind: "session", sessionId: info.sessionId };
}

// Invalid input to a factor endpoint, logged for a signed-in person (sessions
// only: a challenge names its account only once it is locked). Only the
// field codes are kept, never what was sent (codes, key answers).
export async function logFactorInput(
  c: Context,
  actor: ActorRef,
  action: AuditAction,
  response: Response,
): Promise<void> {
  if (actor.kind !== "session") return;
  await logRefusedInput(c, { kind: "session", sessionId: actor.sessionId }, action, response, {});
}

// `Authorization: Challenge <token>`; whether the challenge is usable for
// `purpose` is decided under its lock. 401 challenge_invalid without a token.
export function challengeActor(
  c: Context,
  purpose: "enrolment" | "setup_enrolment",
): ActorRef | Response {
  const blocked = unavailable(c);
  if (blocked) return blocked;
  const token = readChallengeToken(c.req.header("authorization"));
  if (!token) return failureResponse(c, refuse("challenge_invalid"));
  return { kind: "challenge", tokenHash: challengeTokenHash(token), purpose };
}
