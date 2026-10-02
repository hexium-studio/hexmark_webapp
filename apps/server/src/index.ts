import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./env";

const app = new Hono();

// Liveness probe for Docker; does not touch the database.
app.get("/health", (c) => c.json({ status: "ok" }));

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Hexmark server listening on port ${info.port}`);
});

// Docker sends SIGTERM on stop; close open connections and exit cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
