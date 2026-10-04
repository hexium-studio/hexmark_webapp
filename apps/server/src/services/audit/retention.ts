// When audit events are due for deletion (AUDIT_RETENTION_DAYS). Pure.
// Days are 24 hours (timestamps are UTC); an event written at time T is
// deleted once T + retention has passed.

const DAY_MS = 24 * 60 * 60 * 1000;

// Events written at or before this time are due at `now`.
export function auditPurgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
