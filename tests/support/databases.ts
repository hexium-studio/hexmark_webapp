import { randomBytes } from "node:crypto";
import { adminClient, type PgServer } from "./postgres-container";

// One empty database per test file (integration) or per worker (e2e) in the
// shared throwaway container, so tests running in parallel never see each
// other's rows.

export interface TestDatabase {
  name: string;
  server: PgServer;
  // Client for assertions and seed data, connected to this database.
  sql: ReturnType<typeof adminClient>;
  drop(): Promise<void>;
}

export async function createDatabase(server: PgServer, prefix: string): Promise<TestDatabase> {
  const name = `${prefix}_${randomBytes(4).toString("hex")}`.toLowerCase();
  const admin = adminClient(server);
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 1 });
  }
  const sql = adminClient(server, name);
  return {
    name,
    server,
    sql,
    async drop() {
      await sql.end({ timeout: 1 });
      const cleanup = adminClient(server);
      try {
        await cleanup.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end({ timeout: 1 });
      }
    },
  };
}

// Back to "setup not done": no users and no instance settings. Tables that
// do not exist yet (migrations not run) are fine.
export async function resetSetupData(db: TestDatabase): Promise<void> {
  await db.sql.unsafe(`
    do $$ begin
      if to_regclass('public.users') is not null then
        truncate table users, instance_settings;
      end if;
    end $$;
  `);
}
