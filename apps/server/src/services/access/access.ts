import { type NotePermission, ROLE_PERMISSIONS, type UserRole } from "@hexmark/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { type ApiToken, apiTokenEntries, apiTokens, sessions, users } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { refuse } from "../notes/refusals";
import { signInRefusal, signInRefusalFailure } from "../sessions/sign-in-policy";
import { type AccessPolicy, heldPermissions } from "./policy";

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
  // What may be done where (policy.ts): the role for a session, the token's
  // mode and entries intersected with the owner's role for a token.
  policy: AccessPolicy;
  // Everything held anywhere (policy.ts, heldPermissions).
  permissions: readonly NotePermission[];
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
    ...withPolicy({ mode: "all", granted: ROLE_PERMISSIONS[row.role] }),
    reauthenticatedAt: row.reauthenticatedAt,
  };
}

function withPolicy(policy: AccessPolicy) {
  return { policy, permissions: heldPermissions(policy) };
}

// The token's policy from its row and its entries, read while the token's
// row is locked: entries change only with that row locked for update
// (services/api-tokens), so they are what the row says.
async function tokenPolicy(
  tx: Transaction,
  token: ApiToken,
  role: UserRole,
): Promise<AccessPolicy> {
  const rows = await tx.select().from(apiTokenEntries).where(eq(apiTokenEntries.tokenId, token.id));
  const granted = ROLE_PERMISSIONS[role];
  const target = (row: (typeof rows)[number]) => row.folderId ?? row.noteId ?? "";
  const of = (kind: "folder" | "note") => rows.filter((row) => row.targetKind === kind);
  if (token.accessMode === "deny_list") {
    return {
      mode: "deny_list",
      granted,
      base: token.basePermissions ?? [],
      folders: new Set(of("folder").map(target)),
      notes: new Set(of("note").map(target)),
    };
  }
  const listed = (kind: "folder" | "note") =>
    new Map(of(kind).map((row) => [target(row), row.permissions ?? []] as const));
  return { mode: "allow_list", granted, folders: listed("folder"), notes: listed("note") };
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
    ...withPolicy(await tokenPolicy(tx, token, role)),
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
