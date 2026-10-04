import { sql } from "drizzle-orm";
import { type Database, getDb } from "../../db/client";
import { AUDIT_PURGE_SETTING } from "../../db/schema";
import { SYSTEM_ACTOR } from "./actor";
import { recordEvent } from "./record";
import { auditPurgeCutoff } from "./retention";

// Deleting audit events older than the retention (AUDIT_RETENTION_DAYS).
// The table refuses DELETE unless the transaction has set the purge setting
// (migration 0009); this is the only code that sets it. The rows deleted are
// not logged one by one: one system event audit.purged with the count is
// written in the same transaction (and itself deleted once it is due).
// Several servers may share one database: one purges at a time (advisory
// lock), the others skip the round.

const PURGE_LOCK = sql`hashtext('hexmark.audit_purge')`;

export interface AuditPurgeReport {
  skipped: boolean;
  removed: number;
}

export async function purgeAuditEvents(
  now: Date,
  retentionDays: number,
  db: Database = getDb(),
): Promise<AuditPurgeReport> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${PURGE_LOCK}) as locked`,
    );
    if (lock?.locked !== true) return { skipped: true, removed: 0 };
    await tx.execute(sql`select set_config(${AUDIT_PURGE_SETTING}, 'on', true)`);
    const cutoff = auditPurgeCutoff(now, retentionDays);
    const rows = await tx.execute(sql`
      delete from audit_events where occurred_at <= ${cutoff.toISOString()}::timestamptz
      returning id
    `);
    await tx.execute(sql`select set_config(${AUDIT_PURGE_SETTING}, 'off', true)`);
    if (rows.length > 0) {
      await recordEvent(
        tx,
        {
          actor: SYSTEM_ACTOR,
          source: "system",
          action: "audit.purged",
          target: { kind: "audit" },
          details: { removed: rows.length, retentionDays, cutoff: cutoff.toISOString() },
        },
        now,
      );
    }
    return { skipped: false, removed: rows.length };
  });
}
