import type { ApiTokenInfo, CreateApiTokenInput } from "@hexmark/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { type ApiToken, apiTokens } from "../../db/schema";
import { type Failure, fail, type Outcome } from "../../lib/outcome";
import { type Access, type AccessRef, lockAccess } from "../access/access";
import { type AccessEvent, recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { isUuid } from "../notes/addressing";
import { isFailure, refuse } from "../notes/refusals";
import { runNoteTransaction } from "../notes/transaction";
import { reauthenticationRefusal } from "../sessions/reauthentication";
import { accessRefusal, insertEntries } from "./token-entries";
import { newApiToken } from "./token-format";
import { tokenInfos } from "./token-info";

// A user's API tokens: created (the token is returned this once), listed,
// changed (token-update.ts) and revoked. Only from a session: a token cannot
// manage tokens. A token grants access to the wiki, so creating or changing
// one is a sensitive action (password re-entered recently); revoking one
// only takes access away and is not. The legacy columns permissions and
// folder_scope (migration 0010) are neither read nor written.

// Violations of a target deleted for good while it was being listed.
export const ENTRY_TARGET_GONE: Record<string, Failure> = {
  api_token_entries_folder_id_folders_id_fk: refuse("folder_not_found"),
  api_token_entries_note_id_notes_id_fk: refuse("not_found"),
};

// What the audit log keeps of a token: its id, name, prefix and what it
// may do - never the token.
export function tokenEvent(
  action: "token.created" | "token.revoked" | "token.updated",
  token: ApiTokenInfo,
  details: Record<string, unknown>,
): AccessEvent {
  return {
    action,
    target: { kind: "token", id: token.id, label: token.name },
    details: { tokenPrefix: token.prefix, ...details },
  };
}

function accessFacts(token: ApiTokenInfo) {
  return {
    mode: token.mode,
    basePermissions: token.basePermissions,
    entries: token.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.targetId,
      path: entry.path,
      permissions: entry.permissions,
    })),
    expiresAt: token.expiresAt,
  };
}

// The session's access, locked; tokens are refused here.
export async function sessionAccess(
  tx: Transaction,
  ref: AccessRef,
  now: Date,
): Promise<Access | Failure> {
  if (ref.kind !== "session") return refuse("unauthenticated");
  return lockAccess(tx, ref, now);
}

export async function oneInfo(tx: Transaction, row: ApiToken): Promise<ApiTokenInfo> {
  const [info] = await tokenInfos(tx, [row]);
  if (!info) throw new Error("the token was not described");
  return info;
}

export function createToken(
  ref: AccessRef,
  now: Date,
  input: CreateApiTokenInput,
): Promise<Outcome<{ token: string; info: ApiTokenInfo }>> {
  return runAudited(
    { ref, action: "token.created", input },
    async (tx) => {
      const access = await sessionAccess(tx, ref, now);
      if (isFailure(access)) return access;
      const stale = reauthenticationRefusal(access.reauthenticatedAt, now);
      if (stale) return stale;
      const basePermissions = input.basePermissions ?? null;
      const wanted = { mode: input.mode, basePermissions, entries: input.entries };
      const refused = await accessRefusal(tx, access.role, wanted);
      if (refused) return refused;
      if (input.expiresAt && input.expiresAt <= now) {
        return fail(400, "validation", { fields: { expiresAt: { code: "invalid" } } });
      }
      const { token, hash, prefix } = newApiToken();
      const [row] = await tx
        .insert(apiTokens)
        .values({
          userId: access.userId,
          name: input.name,
          tokenHash: hash,
          tokenPrefix: prefix,
          accessMode: input.mode,
          basePermissions: input.mode === "deny_list" ? basePermissions : null,
          expiresAt: input.expiresAt,
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error("the token was not inserted");
      await insertEntries(tx, row.id, row.accessMode, input.entries, now);
      const created = await oneInfo(tx, row);
      await recordAccessEvent(
        tx,
        access,
        tokenEvent("token.created", created, accessFacts(created)),
        now,
      );
      return { token, info: created };
    },
    ENTRY_TARGET_GONE,
  );
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
    return tokenInfos(tx, rows);
  });
}

// One of the session's own tokens, locked for update; not_found otherwise.
export async function lockOwnToken(
  tx: Transaction,
  access: Access,
  id: string,
): Promise<ApiToken | Failure> {
  if (!isUuid(id)) return refuse("not_found");
  const [row] = await tx
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, access.userId)))
    .for("update");
  return row ?? refuse("not_found");
}

// Stops the token at once: every request decides on the token's row
// (access.ts). Revoking a revoked token changes nothing.
export function revokeToken(ref: AccessRef, now: Date, id: string): Promise<Outcome<ApiTokenInfo>> {
  return runAudited({ ref, action: "token.revoked", input: { id } }, async (tx) => {
    const access = await sessionAccess(tx, ref, now);
    if (isFailure(access)) return access;
    const row = await lockOwnToken(tx, access, id);
    if (isFailure(row)) return row;
    const [revoked] = row.revokedAt
      ? [row]
      : await tx.update(apiTokens).set({ revokedAt: now }).where(eq(apiTokens.id, id)).returning();
    if (!revoked) throw new Error("the token was not updated");
    const result = await oneInfo(tx, revoked);
    const details = { ...accessFacts(result), alreadyRevoked: row.revokedAt !== null };
    await recordAccessEvent(tx, access, tokenEvent("token.revoked", result, details), now);
    return result;
  });
}
