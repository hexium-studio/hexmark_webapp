import type { PurgedItems } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { type Database, getDb, type Transaction } from "../../db/client";
import { SYSTEM_ACTOR } from "../audit/actor";
import { indexBeforeRemoval, recordRemovals } from "./removal-events";
import { purgeCutoff } from "./retention";
import { removedCounts, removeFromTrash } from "./trash-remove";

// The purge: everything in the trash whose retention has passed is deleted
// for good, each note and folder with an audit event of the system
// (removal-events.ts) in the same transaction. Several servers may share one database; a transaction-level
// advisory lock lets one of them purge at a time, and a server that finds
// it taken skips this round (the next round comes an hour later).

// Taken by the purge (trying) and by emptying the trash (waiting).
const REMOVAL_LOCK = sql`hashtext('hexmark.trash_removal')`;

export async function lockTrashRemoval(tx: Transaction, wait: boolean): Promise<boolean> {
  if (wait) {
    await tx.execute(sql`select pg_advisory_xact_lock(${REMOVAL_LOCK})`);
    return true;
  }
  const [row] = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(${REMOVAL_LOCK}) as locked`,
  );
  return row?.locked === true;
}

export interface PurgeReport extends PurgedItems {
  // Another server held the lock: nothing was looked at.
  skipped: boolean;
}

// `now` is passed in (the job's clock), so tests can move time.
export async function purgeExpiredTrash(
  now: Date,
  retentionDays: number,
  db: Database = getDb(),
): Promise<PurgeReport> {
  return db.transaction(async (tx) => {
    if (!(await lockTrashRemoval(tx, false))) return { skipped: true, notes: 0, folders: 0 };
    const index = await indexBeforeRemoval(tx);
    const removed = await removeFromTrash(tx, { before: purgeCutoff(now, retentionDays) });
    const log = {
      actor: SYSTEM_ACTOR,
      source: "system",
      kind: "purged",
      via: "retention",
    } as const;
    await recordRemovals(tx, index, removed, log, now);
    return { skipped: false, ...removedCounts(removed) };
  });
}
