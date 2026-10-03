import { defineConfig } from "drizzle-kit";
import { readDatabaseConfig } from "./src/config/env";

// Same connection settings as the server (POSTGRES_*, DB_HOST, DB_PORT from
// the repository root .env, loaded by the db:* scripts). Only commands that
// talk to the database (migrate) need them; generating migrations works
// without.
const database = readDatabaseConfig();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./drizzle",
  ...(database.configured ? { dbCredentials: database.connection } : {}),
});
