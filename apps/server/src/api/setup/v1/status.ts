import type { SetupStatus } from "@hexmark/shared";
import type { Context } from "hono";
import { serverNotConfigured } from "../../../config/secrets";
import { isDatabaseMigrated, isSetupOpen, pingDatabase } from "../_lib/setup-state";
import { getSetupTokenState } from "../_lib/setup-token";

// GET /api/setup/v1/status: what step 1 of the setup wizard shows. 200 with
// SetupStatus once the database can answer whether setup is open, else 503
// with the database state and whether the token and the keys in .env
// (src/config/secrets.ts) are configured.
export async function getSetupStatus(c: Context): Promise<Response> {
  const token = getSetupTokenState();
  const secretsConfigured = !serverNotConfigured();
  const database = { reachable: await pingDatabase(), migrated: isDatabaseMigrated() };
  const unavailable = () =>
    c.json(
      {
        error: "database_unavailable",
        database,
        setupTokenConfigured: token.configured,
        secretsConfigured,
      },
      503,
    );
  if (!database.reachable || !database.migrated) return unavailable();
  let open: boolean;
  try {
    open = await isSetupOpen();
  } catch {
    return unavailable();
  }
  const status: SetupStatus = {
    setupOpen: open,
    setupTokenPresent: token.present,
    setupTokenConfigured: token.configured,
    secretsConfigured,
    database,
  };
  return c.json(status, 200);
}
