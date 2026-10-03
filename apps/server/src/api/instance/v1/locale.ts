import type { Context } from "hono";
import { getDbStatus } from "../../../db/status";
import { describeError } from "../../../lib/errors";
import { readInstanceDefaultLocale } from "../_lib/instance-locale";

// GET /api/instance/v1/locale: the instance default locale, which the web app
// uses for visitors who have neither a saved nor a chosen locale. Public on
// purpose: it reveals only the UI language. 200 with
// { defaultLocale: "en" | "de" | null } (null until the first admin is
// created), 503 { error: "database_unavailable" } while the database cannot
// answer.
export async function getInstanceLocale(c: Context): Promise<Response> {
  const unavailable = () => c.json({ error: "database_unavailable" }, 503);
  if (!getDbStatus().migrated) return unavailable();
  try {
    return c.json({ defaultLocale: await readInstanceDefaultLocale() }, 200);
  } catch (error) {
    console.error(`Reading the instance default locale failed: ${describeError(error)}`);
    return unavailable();
  }
}
