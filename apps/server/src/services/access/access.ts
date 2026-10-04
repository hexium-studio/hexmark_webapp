import type { NotePermission, UserRole } from "@hexmark/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { apiTokens, sessions, users } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { refuse } from "../notes/refusals";
import { signInRefusal, signInRefusalFailure } from "../sessions/sign-in-policy";
import { effectivePermissions } from "./note-permissions";

// Who a request to the notes core acts for: a human's session (web app) or an
// agent's API token. Every note operation starts its transaction with
// lockAccess, so it decides on the session or token row it has locked: a
// token revoked or a session ended a moment earlier is refused, not trusted
// from the check at the door (request-access.ts).

// A session always comes through the web app; a token through the HTTP API
// or the MCP server (`via`, recorded as the audit log's source).
export type AccessRef =
  | { kind: "session"; sessionId: string }
  | { kind: "token"; tokenId: string; via: "http" | "mcp" };

// Recorded with every change (actor columns): exactly one id, plus the name
// shown in the history - the username, or the token's name.
export interface Actor {
  userId: string | null;
  tokenId: string | null;
  name: string;
}

export interface Access {
  ref: AccessRef;
  // The human, or the token's owner.
  userId: string;
  role: UserRole;
  actor: Actor;
  // Role and token permissions intersected (note-permissions.ts).
  permissions: NotePermission[];
  // Token only: the token's own permissions as stored.
  tokenPermissions: NotePermission[] | null;
  // Token only: the folders it is limited to (with their subfolders); null
  // means the whole wiki.
  folderScope: string[] | null;
  // Session only: when the password was last re-entered, read from the
  // locked session row (sensitive actions check it, reauthentication.ts).
  reauthenticatedAt: Date | null;
}

async function lockSessionAccess(
  tx: Transaction,
  ref: Extract<AccessRef, { kind: "session" }>,
  now: Date,
): Promise<Access | Failure> {
  const [row] = await tx
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      reauthenticatedAt: sessions.reauthenticatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.id, ref.sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
    )
    .for("share", { of: sessions });
  if (!row) return refuse("unauthenticated");
  return {
    ref,
    userId: row.userId,
    role: row.role,
    actor: { userId: row.userId, tokenId: null, name: row.username },
    permissions: effectivePermissions(row.role, null),
    tokenPermissions: null,
    folderScope: null,
    reauthenticatedAt: row.reauthenticatedAt,
  };
}

async function lockTokenAccess(
  tx: Transaction,
  ref: Extract<AccessRef, { kind: "token" }>,
  now: Date,
): Promise<Access | Failure> {
  const [row] = await tx
    .select({ token: apiTokens, role: users.role })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.id, ref.tokenId))
    .for("share", { of: apiTokens });
  if (!row) return refuse("unauthenticated");
  const { token, role } = row;
  if (token.revokedAt) return refuse("token_revoked");
  if (token.expiresAt && token.expiresAt <= now) return refuse("token_expired");
  return {
    ref,
    userId: token.userId,
    role,
    actor: { userId: null, tokenId: token.id, name: token.name },
    permissions: effectivePermissions(role, token.permissions),
    tokenPermissions: token.permissions,
    folderScope: token.folderScope,
    reauthenticatedAt: null,
  };
}

// The access a request has, decided on the locked session or token row.
// While SETUP_TOKEN is set (or an instance key is missing) nothing works, the
// same rule as for signing in (sign-in-policy.ts).
export async function lockAccess(
  tx: Transaction,
  ref: AccessRef,
  now: Date,
): Promise<Access | Failure> {
  const refusal = signInRefusal();
  if (refusal) return signInRefusalFailure(refusal);
  return ref.kind === "session" ? lockSessionAccess(tx, ref, now) : lockTokenAccess(tx, ref, now);
}
