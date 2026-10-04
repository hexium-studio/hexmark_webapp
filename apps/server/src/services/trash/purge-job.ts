import { auditRetentionDays } from "../../config/audit";
import { TRASH_PURGE_INTERVAL_MS, trashRetentionDays } from "../../config/trash";
import { getDbStatus } from "../../db/status";
import { describeError } from "../../lib/errors";
import { purgeAuditEvents } from "../audit/purge";
import { purgeExpiredTrash } from "./purge";

// The hourly purge in the server: once when the database is ready (after
// the migrations, src/index.ts) and then every hour. Each run deletes what
// is due in the trash (TRASH_RETENTION_DAYS) and in the audit log
// (AUDIT_RETENTION_DAYS) and logs the counts - never titles or names. A
// failed part is logged and the next run tries again.

export interface PurgeJobOptions {
  // The time each run purges for; tests move it.
  clock?: () => Date;
  intervalMs?: number;
  retentionDays?: number;
  auditRetentionDays?: number;
}

export interface PurgeJob {
  // One run now (the same as a scheduled one).
  run(): Promise<void>;
  stop(): void;
}

async function purgeTrash(now: Date, days: number): Promise<void> {
  try {
    const report = await purgeExpiredTrash(now, days);
    if (report.skipped) {
      console.log("Trash purge skipped: another server is purging right now.");
      return;
    }
    console.log(
      `Trash purge: removed ${report.notes} notes and ${report.folders} folders ` +
        `(retention ${days} days).`,
    );
  } catch (error) {
    console.error(`Trash purge failed: ${describeError(error)}`);
  }
}

async function purgeAudit(now: Date, days: number): Promise<void> {
  try {
    const report = await purgeAuditEvents(now, days);
    if (report.skipped) {
      console.log("Audit purge skipped: another server is purging right now.");
      return;
    }
    console.log(`Audit purge: removed ${report.removed} events (retention ${days} days).`);
  } catch (error) {
    console.error(`Audit purge failed: ${describeError(error)}`);
  }
}

export function startTrashPurgeJob(options: PurgeJobOptions = {}): PurgeJob {
  const clock = options.clock ?? (() => new Date());
  const trashDays = options.retentionDays ?? trashRetentionDays;
  const auditDays = options.auditRetentionDays ?? auditRetentionDays;
  const run = async () => {
    if (!getDbStatus().migrated) return;
    const now = clock();
    await purgeTrash(now, trashDays);
    await purgeAudit(now, auditDays);
  };
  const timer = setInterval(() => void run(), options.intervalMs ?? TRASH_PURGE_INTERVAL_MS);
  timer.unref();
  void run();
  return { run, stop: () => clearInterval(timer) };
}
