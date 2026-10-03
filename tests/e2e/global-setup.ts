import { startPostgres } from "../support/postgres-container";
import { prepareStandalone } from "../support/web-server";

// Runs once before all e2e tests: checks the production build is there and
// starts the shared throwaway PostgreSQL container. Workers read its
// connection from the environment (fixtures.ts). The returned function is
// the global teardown.

export const PG_ENV = "HEXMARK_E2E_PG";

export default async function globalSetup() {
  prepareStandalone();
  const pg = await startPostgres("e2e");
  process.env[PG_ENV] = JSON.stringify(pg.server);
  return async () => {
    await pg.stop();
  };
}
