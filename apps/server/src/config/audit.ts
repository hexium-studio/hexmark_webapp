import { AUDIT_RETENTION_DAYS } from "@hexmark/shared";

// The audit log. One optional environment variable:
//
//   AUDIT_RETENTION_DAYS  how many days audit events are kept before the
//                         server deletes them (default 365, 1 to 3650). An
//                         event written at time T is deleted once
//                         T + retention has passed, by the hourly job that
//                         also purges the trash.
//
// A malformed value is logged as a configuration error and the default
// applies; the server always starts.

export interface AuditRetentionConfig {
  days: number;
  problem: string | null;
}

// Pure: reads the variable from `source` without logging.
export function readAuditRetention(source: NodeJS.ProcessEnv = process.env): AuditRetentionConfig {
  const raw = source.AUDIT_RETENTION_DAYS?.trim();
  if (!raw) return { days: AUDIT_RETENTION_DAYS.default, problem: null };
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < AUDIT_RETENTION_DAYS.min || value > AUDIT_RETENTION_DAYS.max) {
    return {
      days: AUDIT_RETENTION_DAYS.default,
      problem:
        `AUDIT_RETENTION_DAYS must be a whole number between ${AUDIT_RETENTION_DAYS.min} and ` +
        `${AUDIT_RETENTION_DAYS.max}; using the default ${AUDIT_RETENTION_DAYS.default}.`,
    };
  }
  return { days: value, problem: null };
}

const loaded = readAuditRetention();

export const auditRetentionDays = loaded.days;

// Called once at start-up (src/index.ts).
export function reportAuditConfig(): void {
  if (loaded.problem) console.error(`Configuration error: ${loaded.problem}`);
}

// Requests with an API token that is unknown, revoked or expired are logged
// (auth.token_rejected) at most once per presented value in this window;
// the next event after it counts the ones left out (details.suppressed).
// Kept in memory per server process, for at most this many values.
export const TOKEN_REJECTION_LOG = { windowMs: 10 * 60 * 1000, maxKeys: 10_000 } as const;
