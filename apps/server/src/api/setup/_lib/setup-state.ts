import { sql } from "drizzle-orm";
import { DB_LIVE_CHECK_TIMEOUT_MS } from "../../../config/database";
import { getDb } from "../../../db/client";
import { users } from "../../../db/schema";
import { getDbStatus } from "../../../db/status";

// Database questions behind the setup flow. Tables are only queried after the
// background migration has finished (getDbStatus().migrated).

// Live reachability check. getDbStatus().reachable only reflects the
// migration loop, which stops after the first success.
export async function pingDatabase(timeoutMs = DB_LIVE_CHECK_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = (async () => {
    try {
      await getDb().execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function isDatabaseMigrated(): boolean {
  return getDbStatus().migrated;
}

// Setup is open while no user exists. This is a snapshot for answering
// requests; creating the admin re-checks it under a lock
// (create-first-admin.ts).
export async function isSetupOpen(): Promise<boolean> {
  const rows = await getDb().select({ id: users.id }).from(users).limit(1);
  return rows.length === 0;
}
