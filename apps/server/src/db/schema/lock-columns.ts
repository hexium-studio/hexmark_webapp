import { LOCK_REASON_MAX_LENGTH } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, type PgColumn, text, timestamp } from "drizzle-orm/pg-core";
import { actorChecks, actorColumns, optionalActorPairing } from "./actor-columns";

// Longest lock reason, in characters (shared with the input schemas).
export { LOCK_REASON_MAX_LENGTH };

// Lock bookkeeping shared by notes and folders: when the row was locked, who
// locked it (actor triple locked_by_*) and why. A locked row may not be
// changed by agents; locking a folder also locks everything below it (the
// application derives that, nothing is copied to the descendants). Null
// while the row is not locked.
//
// Columns: locked_at, locked_by_user_id, locked_by_token_id, locked_by_name,
// lock_reason.
export function lockColumns() {
  const lockedBy = actorColumns("locked_by");
  return {
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByUserId: lockedBy.userId,
    lockedByTokenId: lockedBy.tokenId,
    lockedByName: lockedBy.name,
    lockReason: text("lock_reason"),
  };
}

interface LockRefs {
  lockedAt: PgColumn;
  lockedByUserId: PgColumn;
  lockedByTokenId: PgColumn;
  lockedByName: PgColumn;
  lockReason: PgColumn;
}

// The actor checks for locked_by, its pairing with locked_at (all of the
// triple null exactly when locked_at is null; the ids may become null once
// that user or token is deleted) and the reason: only on a locked row, and
// then optional, as locks set before the reason existed have none. The
// application requires a reason where it asks for one (agents locking). A
// reason is 1-500 characters and not only white space.
export function lockChecks(table: string, t: LockRefs) {
  const actor = { userId: t.lockedByUserId, tokenId: t.lockedByTokenId, name: t.lockedByName };
  return [
    ...actorChecks(table, "locked_by", actor),
    optionalActorPairing(table, "locked_by", t.lockedAt, actor),
    check(
      `${table}_lock_reason_check`,
      sql`${t.lockReason} is null or (${t.lockedAt} is not null and char_length(${t.lockReason}) between 1 and ${sql.raw(String(LOCK_REASON_MAX_LENGTH))} and ${t.lockReason} ~ '[^[:space:]]')`,
    ),
  ];
}
