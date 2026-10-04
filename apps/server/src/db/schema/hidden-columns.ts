import { HIDE_REASON_MAX_LENGTH } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, index, type PgColumn, text, timestamp } from "drizzle-orm/pg-core";
import { actorChecks, actorColumns, optionalActorPairing } from "./actor-columns";

// Longest hide reason, in characters (shared with the input schemas).
export { HIDE_REASON_MAX_LENGTH };

// Hidden bookkeeping shared by notes and folders, built like the lock
// (lock-columns.ts): when the row was hidden, who hid it (actor triple
// hidden_by_*) and why. Agents cannot read a hidden note's content, nor
// anything below a hidden folder (the application derives the subtree,
// nothing is copied to the descendants). Independent of the lock: unhiding
// leaves a lock in place. Null while the row is not hidden itself.
//
// Columns: hidden_at, hidden_by_user_id, hidden_by_token_id, hidden_by_name,
// hide_reason.
export function hiddenColumns() {
  const hiddenBy = actorColumns("hidden_by");
  return {
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenByUserId: hiddenBy.userId,
    hiddenByTokenId: hiddenBy.tokenId,
    hiddenByName: hiddenBy.name,
    hideReason: text("hide_reason"),
  };
}

interface HiddenRefs {
  hiddenAt: PgColumn;
  hiddenByUserId: PgColumn;
  hiddenByTokenId: PgColumn;
  hiddenByName: PgColumn;
  hideReason: PgColumn;
}

// The actor checks for hidden_by, its pairing with hidden_at (all of the
// triple null exactly when hidden_at is null; the ids may become null once
// that user or token is deleted) and the reason: only on a hidden row, and
// then optional (people may hide without one; the application requires it
// from agents). A reason is 1-500 characters and not only white space.
export function hiddenChecks(table: string, t: HiddenRefs) {
  const actor = { userId: t.hiddenByUserId, tokenId: t.hiddenByTokenId, name: t.hiddenByName };
  return [
    ...actorChecks(table, "hidden_by", actor),
    optionalActorPairing(table, "hidden_by", t.hiddenAt, actor),
    check(
      `${table}_hide_reason_check`,
      sql`${t.hideReason} is null or (${t.hiddenAt} is not null and char_length(${t.hideReason}) between 1 and ${sql.raw(String(HIDE_REASON_MAX_LENGTH))} and ${t.hideReason} ~ '[^[:space:]]')`,
    ),
  ];
}

// Partial index: only hidden rows, for listing what is hidden.
export function hiddenIndexes(table: string, t: HiddenRefs) {
  return [index(`${table}_hidden_at_idx`).on(t.hiddenAt).where(sql`${t.hiddenAt} is not null`)];
}
