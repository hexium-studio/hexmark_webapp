import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let db: Database | undefined;

// Created on first use so the server starts (and /health answers)
// without a reachable database.
export function getDb(): Database {
  if (db) return db;
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not set. Set it to a PostgreSQL connection URL.");
  }
  db = drizzle({ client: postgres(env.databaseUrl), schema });
  return db;
}
