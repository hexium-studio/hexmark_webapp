import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { api } from "./api";
import { reportSetupTokenFormat, reportSetupTokenState } from "./api/setup/_lib/setup-token-report";
import { env } from "./config/env";
import { startMigrations } from "./db/migrate";
import { describeError } from "./lib/errors";

// Resolved from this entry file: src/index.ts under tsx (pnpm dev) and
// dist/index.js in the tsup bundle both sit one level below the folder that
// holds drizzle/ (apps/server locally, /app in the Docker image).
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const app = new Hono();

// Liveness probe for Docker; does not touch the database.
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api", api);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Logs only the innermost cause: Drizzle's wrapper message lists query
// parameters, which can hold user input.
app.onError((error, c) => {
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}: ${describeError(error)}`);
  return c.json({ error: "internal" }, 500);
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Hexmark server listening on port ${info.port}`);
});

reportSetupTokenFormat();

// The server listens even without a database so the setup wizard can report
// its state (src/db/status.ts). Endpoints that use tables must check
// getDbStatus().migrated first.
startMigrations(env.database, MIGRATIONS_FOLDER, reportSetupTokenState);

// Docker sends SIGTERM on stop; close open connections and exit cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
