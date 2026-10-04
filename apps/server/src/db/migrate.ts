import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  MIGRATION_CONNECT_TIMEOUT_SECONDS,
  MIGRATION_RETRY_INTERVAL_MS,
  MIN_POSTGRES_VERSION_NUM,
} from "../config/database";
import type { DatabaseConfig, DatabaseConnection } from "../config/env";
import { describeError } from "../lib/errors";
import { classifyDbError, setDbStatus } from "./status";

// Refuses PostgreSQL older than MIN_POSTGRES_VERSION_NUM before any
// migration runs, with a message that says what to do (migration 0008 checks
// the same for runs outside the server, such as drizzle-kit migrate).
export async function requireSupportedVersion(client: postgres.Sql): Promise<void> {
  const [row] = await client<{ num: number; version: string }[]>`
    select current_setting('server_version_num')::int as num,
      current_setting('server_version') as version
  `;
  if (row && row.num >= MIN_POSTGRES_VERSION_NUM) return;
  setDbStatus({ reachable: true, migrated: false, reason: "PostgreSQL 18 or newer required" });
  throw new Error(
    `Hexmark needs PostgreSQL 18 or newer, this server runs ${row?.version ?? "an unknown version"}. Upgrade PostgreSQL as described in docs/deployment.md`,
  );
}

// One attempt: connect, then apply all pending migrations from
// `migrationsFolder` (drizzle-kit output). Applied migrations are recorded in
// drizzle.__drizzle_migrations and skipped, so repeating this is safe.
async function attempt(connection: DatabaseConnection, migrationsFolder: string): Promise<void> {
  const client = postgres({
    ...connection,
    max: 1,
    connect_timeout: MIGRATION_CONNECT_TIMEOUT_SECONDS,
    // Silences "already exists, skipping" notices on repeated starts.
    onnotice: () => {},
  });
  try {
    try {
      await client`select 1`;
    } catch (error) {
      setDbStatus({ reachable: false, migrated: false, reason: classifyDbError(error, "connect") });
      throw error;
    }
    setDbStatus({ reachable: true, migrated: false });
    await requireSupportedVersion(client);
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } catch (error) {
      setDbStatus({ reachable: true, migrated: false, reason: classifyDbError(error, "migrate") });
      throw error;
    }
    setDbStatus({ reachable: true, migrated: true });
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}

// Runs in the background so the HTTP server can report the database state
// while it is down. Retries every MIGRATION_RETRY_INTERVAL_MS until
// migrations succeed, then stops. Missing or invalid connection settings are a
// configuration error: reported, not retried (they cannot change without a
// restart). `onReady` runs once after the migrations succeeded.
export function startMigrations(
  database: DatabaseConfig,
  migrationsFolder: string,
  onReady?: () => Promise<void>,
): void {
  if (!database.configured) {
    setDbStatus({ reachable: false, migrated: false, reason: database.reason });
    console.error(
      `Configuration error: ${database.problem}. Check the database settings in .env and restart the server.`,
    );
    return;
  }
  const { connection } = database;
  const run = async (attemptNo: number): Promise<void> => {
    try {
      await attempt(connection, migrationsFolder);
      console.log("Database migrations are up to date.");
    } catch (error) {
      console.error(
        `Database not ready (attempt ${attemptNo}): ${describeError(error)}. ` +
          `Retrying in ${MIGRATION_RETRY_INTERVAL_MS / 1000} s.`,
      );
      setTimeout(() => void run(attemptNo + 1), MIGRATION_RETRY_INTERVAL_MS).unref();
      return;
    }
    // Outside the try: a failing callback must not trigger another migration run.
    await onReady?.().catch((error: unknown) => {
      console.error(`Start-up check after migrations failed: ${describeError(error)}`);
    });
  };
  void run(1);
}
