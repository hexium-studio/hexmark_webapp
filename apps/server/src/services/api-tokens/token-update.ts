import type { ApiTokenInfo, UpdateApiTokenInput } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { apiTokenEntries, apiTokens } from "../../db/schema";
import { fail, type Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { isFailure } from "../notes/refusals";
import { reauthenticationRefusal } from "../sessions/reauthentication";
import { tokenDiff, tokenState } from "./token-diff";
import { accessRefusal, entryKeys, insertEntries, replaceEntries } from "./token-entries";
import { ENTRY_TARGET_GONE, lockOwnToken, oneInfo, sessionAccess, tokenEvent } from "./tokens";

// Changing a token's mode, entries, base permissions or expiry: a sensitive
// action like creating one (password re-entered recently), decided on the
// token's row locked for update. Every request with the token locks that row
// too (services/access), so the change applies to the very next request and
// no request sees half of it. A new mode replaces all entries in this one
// transaction (the database keeps each entry's mode equal to its token's, so
// the old entries go first). The audit log gets what changed, before and
// after (token-diff.ts).

const invalid = (field: string, code: "required" | "invalid") =>
  fail(400, "validation", { fields: { [field]: { code } } });

export function updateToken(
  ref: AccessRef,
  now: Date,
  id: string,
  input: UpdateApiTokenInput,
): Promise<Outcome<ApiTokenInfo>> {
  return runAudited(
    { ref, action: "token.updated", input: { id, ...input } },
    async (tx) => {
      const access = await sessionAccess(tx, ref, now);
      if (isFailure(access)) return access;
      const stale = reauthenticationRefusal(access.reauthenticatedAt, now);
      if (stale) return stale;
      const row = await lockOwnToken(tx, access, id);
      if (isFailure(row)) return row;
      const before = await oneInfo(tx, row);
      const mode = input.mode ?? row.accessMode;
      const newMode = mode !== row.accessMode;
      if (newMode && input.entries === undefined) return invalid("entries", "required");
      const basePermissions =
        input.basePermissions !== undefined
          ? input.basePermissions
          : newMode
            ? null
            : row.basePermissions;
      const entries =
        input.entries ??
        before.entries.map((entry) => ({
          kind: entry.kind,
          id: entry.targetId,
          permissions: entry.permissions ?? undefined,
        }));
      const kept = newMode ? new Set<string>() : entryKeys(before.entries);
      const refused = await accessRefusal(
        tx,
        access.role,
        { mode, basePermissions, entries },
        kept,
      );
      if (refused) return refused;
      if (input.expiresAt && input.expiresAt <= now) return invalid("expiresAt", "invalid");
      if (newMode) await tx.delete(apiTokenEntries).where(eq(apiTokenEntries.tokenId, row.id));
      const [updated] = await tx
        .update(apiTokens)
        .set({
          accessMode: mode,
          basePermissions: mode === "deny_list" ? basePermissions : null,
          expiresAt: input.expiresAt === undefined ? row.expiresAt : input.expiresAt,
        })
        .where(eq(apiTokens.id, row.id))
        .returning();
      if (!updated) throw new Error("the token was not updated");
      if (newMode) await insertEntries(tx, row.id, mode, entries, now);
      else if (input.entries !== undefined) await replaceEntries(tx, row.id, mode, entries, now);
      const after = await oneInfo(tx, updated);
      const diff = tokenDiff(tokenState(before), tokenState(after));
      await recordAccessEvent(tx, access, tokenEvent("token.updated", after, diff), now);
      return after;
    },
    ENTRY_TARGET_GONE,
  );
}
