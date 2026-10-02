import { defineConfig } from "drizzle-kit";

// DATABASE_URL is only needed for commands that talk to the database
// (migrate); generating migrations works without it.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
