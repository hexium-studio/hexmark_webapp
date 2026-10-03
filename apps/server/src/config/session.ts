import { formatDuration, parseDuration } from "../lib/duration";

// Lifetimes of human sessions (sign-in in the browser). Three optional
// environment variables, each a duration such as "5m" or "28d"
// (src/lib/duration.ts):
//
//   SESSION_ROTATION      the session token is replaced after this much time
//                         (checked on use, so only while the session is used)
//   SESSION_IDLE_TIMEOUT  a session without "remember me" ends after this long
//                         without a request
//   SESSION_MAX_AGE       every session ends this long after sign-in, with or
//                         without "remember me"; never extended
//
// The server always starts: a value that is malformed or outside its bounds
// is logged as a configuration error and replaced by its default. If the
// values contradict each other (rotation must be shorter than the idle
// timeout, the idle timeout at most the maximum age), all three defaults apply.

export interface SessionDurations {
  rotationMs: number;
  idleTimeoutMs: number;
  maxAgeMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface DurationSetting {
  variable: string;
  key: keyof SessionDurations;
  defaultMs: number;
  minMs: number;
  maxMs: number;
}

export const SESSION_DURATION_SETTINGS: readonly DurationSetting[] = [
  {
    variable: "SESSION_ROTATION",
    key: "rotationMs",
    defaultMs: 5 * MINUTE,
    minMs: MINUTE,
    maxMs: HOUR,
  },
  {
    variable: "SESSION_IDLE_TIMEOUT",
    key: "idleTimeoutMs",
    defaultMs: HOUR,
    minMs: 5 * MINUTE,
    maxMs: 7 * DAY,
  },
  {
    variable: "SESSION_MAX_AGE",
    key: "maxAgeMs",
    defaultMs: 28 * DAY,
    minMs: HOUR,
    maxMs: 365 * DAY,
  },
];

export const DEFAULT_SESSION_DURATIONS = Object.fromEntries(
  SESSION_DURATION_SETTINGS.map((setting) => [setting.key, setting.defaultMs]),
) as unknown as SessionDurations;

// After a rotation the previous token stays valid this long, so requests
// that were already on their way with it (parallel page loads) still succeed.
export const SESSION_ROTATION_GRACE_MS = 30_000;

// last_seen_at is written at most this often per session, to limit writes.
// The idle timeout is therefore exact to within this interval.
export const SESSION_LAST_SEEN_INTERVAL_MS = MINUTE;

// Random bytes per session token (sent base64url-encoded, 43 characters).
export const SESSION_TOKEN_BYTES = 32;

export interface SessionConfigResult {
  durations: SessionDurations;
  // One sentence per problem, for the start-up log. Never empty strings.
  problems: string[];
}

function readOne(setting: DurationSetting, raw: string | undefined): number | string {
  if (raw === undefined || raw.trim() === "") return setting.defaultMs;
  const fallback = `using the default ${formatDuration(setting.defaultMs)}`;
  const ms = parseDuration(raw);
  if (ms === null) {
    return `${setting.variable} must be a whole number followed by s, m, h or d (e.g. "${formatDuration(setting.defaultMs)}"); ${fallback}.`;
  }
  if (ms < setting.minMs || ms > setting.maxMs) {
    return `${setting.variable} must be between ${formatDuration(setting.minMs)} and ${formatDuration(setting.maxMs)}; ${fallback}.`;
  }
  return ms;
}

// Pure: reads the three variables from `source` without logging.
export function readSessionConfig(source: NodeJS.ProcessEnv = process.env): SessionConfigResult {
  const durations = { ...DEFAULT_SESSION_DURATIONS };
  const problems: string[] = [];
  for (const setting of SESSION_DURATION_SETTINGS) {
    const value = readOne(setting, source[setting.variable]);
    if (typeof value === "string") problems.push(value);
    else durations[setting.key] = value;
  }
  const { rotationMs, idleTimeoutMs, maxAgeMs } = durations;
  if (!(rotationMs < idleTimeoutMs && idleTimeoutMs <= maxAgeMs)) {
    problems.push(
      "SESSION_ROTATION must be shorter than SESSION_IDLE_TIMEOUT, and SESSION_IDLE_TIMEOUT " +
        "at most SESSION_MAX_AGE; using the defaults for all three.",
    );
    return { durations: { ...DEFAULT_SESSION_DURATIONS }, problems };
  }
  return { durations, problems };
}

const loaded = readSessionConfig();

export const sessionDurations: SessionDurations = loaded.durations;

// Called once at start-up (src/index.ts).
export function reportSessionConfig(): void {
  for (const problem of loaded.problems) console.error(`Configuration error: ${problem}`);
}
