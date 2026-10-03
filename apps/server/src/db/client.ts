import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DB_CONNECT_TIMEOUT_SECONDS } from "../config/database";
import { env } from "../config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

// The handle inside getDb().transaction(...).
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let db: Database | undefined;

// Created on first use. Migrations run in the background (src/db/migrate.ts);
// callers check getDbStatus().migrated before querying tables.
export function getDb(): Database {
  if (db) return db;
  if (!env.database.configured) {
    throw new Error(`The database is not configured: ${env.database.problem}.`);
  }
  const client = postgres({
    ...env.database.connection,
    connect_timeout: DB_CONNECT_TIMEOUT_SECONDS,
  });
  db = drizzle({ client, schema });
  return db;
}
