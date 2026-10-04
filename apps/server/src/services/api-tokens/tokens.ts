import type { ApiTokenInfo, CreateApiTokenInput } from "@hexmark/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { type ApiToken, apiTokens, folders } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import { type Access, type AccessRef, lockAccess } from "../access/access";
import { beyondRole } from "../access/note-permissions";
import { type AccessEvent, recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { isUuid } from "../notes/addressing";
import { type FolderIndex, loadFolderIndex } from "../notes/folder-index";
import { fieldRefusal, isFailure, refuse } from "../notes/refusals";
import { runNoteTransaction } from "../notes/transaction";
import { reauthenticationRefusal } from "../sessions/reauthentication";
import { newApiToken } from "./token-format";

// A user's API tokens: created (the token is returned this once), listed and
// revoked. Only from a session: a token cannot manage tokens. A token grants
// access to the wiki, so creating one is a sensitive action (password
// re-entered recently); revoking one only takes access away and is not.

function info(row: ApiToken, index: FolderIndex): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    permissions: row.permissions,
    folderScope:
      row.folderScope?.map((id) => ({ id, path: index.get(id) ? index.pathOf(id) : null })) ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

// What the audit log keeps of a token: its id, name, prefix and what it
// may do - never the token.
function tokenEvent(
  action: "token.created" | "token.revoked",
  token: ApiTokenInfo,
  extra: Record<string, unknown> = {},
): AccessEvent {
  return {
    action,
    target: { kind: "token", id: token.id, label: token.name },
    details: {
      tokenPrefix: token.prefix,
      permissions: token.permissions,
      folderScope: token.folderScope,
      expiresAt: token.expiresAt,
      ...extra,
    },
  };
}

// The session's access, locked; tokens are refused here.
async function sessionAccess(
  tx: Transaction,
  ref: AccessRef,
  now: Date,
): Promise<Access | Failure> {
  if (ref.kind !== "session") return refuse("unauthenticated");
  return lockAccess(tx, ref, now);
}

async function missingFolders(tx: Transaction, ids: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const id of ids) {
    const [row] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
      .for("share");
    if (row) found.add(row.id);
  }
  return ids.filter((id) => !found.has(id));
}

export function createToken(
  ref: AccessRef,
  now: Date,
  input: CreateApiTokenInput,
): Promise<Outcome<{ token: string; info: ApiTokenInfo }>> {
  return runAudited({ ref, action: "token.created", input }, async (tx) => {
    const access = await sessionAccess(tx, ref, now);
    if (isFailure(access)) return access;
    const stale = reauthenticationRefusal(access.reauthenticatedAt, now);
    if (stale) return stale;
    // A permission the owner's role lacks could never be used (access.ts).
    const beyond = beyondRole(access.role, input.permissions);
    if (beyond.length > 0) return refuse("forbidden", { permissions: beyond });
    if (input.expiresAt && input.expiresAt <= now) return fieldRefusal("expiresAt", "invalid");
    const missing = input.folderScope ? await missingFolders(tx, input.folderScope) : [];
    if (missing.length > 0) return refuse("folder_not_found", { folderIds: missing });
    const { token, hash, prefix } = newApiToken();
    const [row] = await tx
      .insert(apiTokens)
      .values({
        userId: access.userId,
        name: input.name,
        tokenHash: hash,
        tokenPrefix: prefix,
        permissions: input.permissions,
        folderScope: input.folderScope,
        expiresAt: input.expiresAt,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("the token was not inserted");
    const created = info(row, await loadFolderIndex(tx));
    await recordAccessEvent(tx, access, tokenEvent("token.created", created), now);
    return { token, info: created };
  });
}

// Newest first, revoked ones included (marked by revokedAt).
export function listTokens(ref: AccessRef, now: Date): Promise<Outcome<ApiTokenInfo[]>> {
  return runNoteTransaction(async (tx) => {
    const access = await sessionAccess(tx, ref, now);
    if (isFailure(access)) return access;
    const rows = await tx
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, access.userId))
      .orderBy(desc(apiTokens.createdAt));
    const index = await loadFolderIndex(tx);
    return rows.map((row) => info(row, index));
  });
}

// Stops the token at once: every request decides on the token's row
// (access.ts). Revoking a revoked token changes nothing.
export function revokeToken(ref: AccessRef, now: Date, id: string): Promise<Outcome<ApiTokenInfo>> {
  return runAudited({ ref, action: "token.revoked", input: { id } }, async (tx) => {
    const access = await sessionAccess(tx, ref, now);
    if (isFailure(access)) return access;
    if (!isUuid(id)) return refuse("not_found");
    const [row] = await tx
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, access.userId)))
      .for("update");
    if (!row) return refuse("not_found");
    const [revoked] = row.revokedAt
      ? [row]
      : await tx.update(apiTokens).set({ revokedAt: now }).where(eq(apiTokens.id, id)).returning();
    if (!revoked) throw new Error("the token was not updated");
    const result = info(revoked, await loadFolderIndex(tx));
    const event = tokenEvent("token.revoked", result, { alreadyRevoked: row.revokedAt !== null });
    await recordAccessEvent(tx, access, event, now);
    return result;
  });
}
