import type { TestProject } from "vitest/node";
import type { PgServer } from "../support/postgres-container";
import { startPostgres } from "../support/postgres-container";

// Starts one throwaway PostgreSQL 18 container for the integration run and
// removes it afterwards (its guard removes it as well if this process dies).

declare module "vitest" {
  export interface ProvidedContext {
    pg: PgServer;
  }
}

export default async function setup(project: TestProject) {
  const pg = await startPostgres("integration");
  project.provide("pg", pg.server);
  return async () => {
    await pg.stop();
  };
}
