import type { Locale } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { DB_LIVE_CHECK_TIMEOUT_MS } from "../../../config/database";
import { getDb } from "../../../db/client";
import { instanceSettings } from "../../../db/schema";

// Reads the instance default locale from the single instance_settings row
// (id 1). The row is written together with the first admin, so before setup
// there is none and the result is null. Callers check that the migrations
// have run first (getDbStatus().migrated).
// The web app asks on page requests, so a database that accepts connections
// but does not answer must not hold the request: after `timeoutMs` this
// rejects like any other database error.
export async function readInstanceDefaultLocale(
  timeoutMs = DB_LIVE_CHECK_TIMEOUT_MS,
): Promise<Locale | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database query timed out")), timeoutMs);
  });
  const query = getDb()
    .select({ defaultLocale: instanceSettings.defaultLocale })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
    .limit(1);
  try {
    const rows = await Promise.race([query, timeout]);
    return rows[0]?.defaultLocale ?? null;
  } finally {
    clearTimeout(timer);
  }
}
