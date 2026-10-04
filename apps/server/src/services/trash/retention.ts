// When items in the trash are purged. Pure. An item deleted at time T is
// due once T + retention has passed: with 28 days, an item deleted on day 1
// is purged on day 29. Days are 24 hours (timestamps are UTC).

const DAY_MS = 24 * 60 * 60 * 1000;

export function purgeAt(deletedAt: Date, retentionDays: number): Date {
  return new Date(deletedAt.getTime() + retentionDays * DAY_MS);
}

// Items deleted at or before this time are due at `now`.
export function purgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

export function isDue(deletedAt: Date, now: Date, retentionDays: number): boolean {
  return now.getTime() >= purgeAt(deletedAt, retentionDays).getTime();
}
