import type { AuditActorKind, AuditSource } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { AUDIT_SYSTEM_ACTOR_NAME, apiTokens, sessions, users } from "../../db/schema";
import type { Access, AccessRef } from "../access/access";

// Who an audit event is about and where the request came in. Names are
// snapshots: the username, the token's name or "System" at the time.

export interface AuditActor {
  kind: AuditActorKind;
  userId: string | null;
  tokenId: string | null;
  name: string;
}

export const SYSTEM_ACTOR: AuditActor = {
  kind: "system",
  userId: null,
  tokenId: null,
  name: AUDIT_SYSTEM_ACTOR_NAME,
};

// A sign-in whose e-mail matched no account: the e-mail is not logged.
export const UNKNOWN_PERSON: AuditActor = {
  kind: "human",
  userId: null,
  tokenId: null,
  name: "unknown",
};

// A request with an API token that matches no token: nothing of it is logged.
export const INVALID_TOKEN: AuditActor = {
  kind: "agent",
  userId: null,
  tokenId: null,
  name: "invalid token",
};

export function personActor(user: { id: string; username: string }): AuditActor {
  return { kind: "human", userId: user.id, tokenId: null, name: user.username };
}

export function tokenActor(token: { id: string; name: string }): AuditActor {
  return { kind: "agent", userId: null, tokenId: token.id, name: token.name };
}

// A session comes through the web app; a token through the HTTP API or MCP.
export function sourceOf(ref: AccessRef): AuditSource {
  return ref.kind === "session" ? "web" : ref.via;
}

// The actor of a request whose access was decided (access.ts).
export function actorOfAccess(access: Access): AuditActor {
  const { actor } = access;
  return actor.tokenId
    ? tokenActor({ id: actor.tokenId, name: actor.name })
    : personActor({ id: actor.userId ?? access.userId, username: actor.name });
}

// The person with this id, read outside any transaction (for failures,
// written after the action rolled back). Unknown when the account is gone.
export async function actorOfUser(userId: string): Promise<AuditActor> {
  const [user] = await getDb()
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId));
  return user ? personActor(user) : UNKNOWN_PERSON;
}

// The actor behind a session or token reference, also when that session
// ended or the token was revoked meanwhile (it is still who tried).
export async function actorOfRef(ref: AccessRef): Promise<AuditActor> {
  if (ref.kind === "token") {
    const [token] = await getDb()
      .select({ id: apiTokens.id, name: apiTokens.name })
      .from(apiTokens)
      .where(eq(apiTokens.id, ref.tokenId));
    return token ? tokenActor(token) : INVALID_TOKEN;
  }
  const [session] = await getDb()
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, ref.sessionId));
  return session ? actorOfUser(session.userId) : UNKNOWN_PERSON;
}
