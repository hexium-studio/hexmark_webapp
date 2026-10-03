import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMigrations } from "../../apps/server/src/db/migrate";
import { getDbStatus } from "../../apps/server/src/db/status";
import type { TestDatabase } from "../support/databases";
import { SERVER_MIGRATIONS } from "../support/paths";

// Runs the server's own start-up migration code against a test database.

function connectionOf(db: TestDatabase) {
  const { host, port, user, password } = db.server;
  return { host, port, user, password, database: db.name };
}

// Runs the server's start-up migration once and waits for the result.
export function migrate(db: TestDatabase, folder = SERVER_MIGRATIONS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`migration failed: ${getDbStatus().reason}`)),
      20_000,
    );
    startMigrations({ configured: true, connection: connectionOf(db) }, folder, async () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// A copy of the migrations folder that knows only the first `count` migrations.
export function firstMigrations(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hexmark-migrations-"));
  cpSync(SERVER_MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}
