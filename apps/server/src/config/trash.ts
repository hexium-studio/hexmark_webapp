import { TRASH_RETENTION_DAYS } from "@hexmark/shared";

// The trash. One optional environment variable:
//
//   TRASH_RETENTION_DAYS  how many days deleted notes and folders stay in the
//                         trash before the server purges them for good
//                         (default 28, 1 to 3650). An item deleted at time T
//                         is purged once T + retention has passed, so with
//                         the default on day 29.
//
// A malformed value is logged as a configuration error and the default
// applies; the server always starts. Default and bounds are shared with the
// tool descriptions (@hexmark/shared).

export interface TrashRetentionConfig {
  days: number;
  problem: string | null;
}

// Pure: reads the variable from `source` without logging.
export function readTrashRetention(source: NodeJS.ProcessEnv = process.env): TrashRetentionConfig {
  const raw = source.TRASH_RETENTION_DAYS?.trim();
  if (!raw) return { days: TRASH_RETENTION_DAYS.default, problem: null };
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < TRASH_RETENTION_DAYS.min || value > TRASH_RETENTION_DAYS.max) {
    return {
      days: TRASH_RETENTION_DAYS.default,
      problem:
        `TRASH_RETENTION_DAYS must be a whole number between ${TRASH_RETENTION_DAYS.min} and ` +
        `${TRASH_RETENTION_DAYS.max}; using the default ${TRASH_RETENTION_DAYS.default}.`,
    };
  }
  return { days: value, problem: null };
}

const loaded = readTrashRetention();

export const trashRetentionDays = loaded.days;

// Called once at start-up (src/index.ts).
export function reportTrashConfig(): void {
  if (loaded.problem) console.error(`Configuration error: ${loaded.problem}`);
}

// How often the purge job runs after the run at start-up.
export const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;
