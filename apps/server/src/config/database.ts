// Database connection defaults and timing. Credentials come from the
// environment (src/config/env.ts).

// Used when DB_HOST / DB_PORT are not set (`pnpm dev` against the database
// published by compose.dev.yaml). Docker Compose sets both explicitly.
export const DEFAULT_DB_HOST = "localhost";
export const DEFAULT_DB_PORT = 5432;

// Connect timeout of the shared client used by requests. Short, so requests do
// not pile up while the database is down (the driver default is 30 s).
export const DB_CONNECT_TIMEOUT_SECONDS = 5;

// Connect timeout of the start-up migration run.
export const MIGRATION_CONNECT_TIMEOUT_SECONDS = 10;

// Pause between migration attempts while the database is not ready.
export const MIGRATION_RETRY_INTERVAL_MS = 5_000;

// Upper bound for a live reachability check (e.g. the setup status).
export const DB_LIVE_CHECK_TIMEOUT_MS = 2_000;
