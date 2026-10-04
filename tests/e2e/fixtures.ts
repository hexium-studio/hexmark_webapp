import { test as base, expect } from "@playwright/test";
import { createDatabase, resetSetupData, type TestDatabase } from "../support/databases";
import {
  type HexmarkServer,
  type ServerOptions,
  startHexmarkServer,
  TEST_SETUP_TOKEN,
} from "../support/hexmark-server";
import { startForwarder } from "../support/ports";
import type { PgServer } from "../support/postgres-container";
import { startWebServer, type WebServer } from "../support/web-server";
import { PG_ENV } from "./global-setup";

// Fixtures of the e2e tests. Each worker runs a stack of its own: database,
// API server (production bundle) and web server (standalone build). Before
// every test the stack is reset to "setup not done" and the API server is
// restarted, so attempt counters start at zero too.
//
// The API server starts on a port the operating system picks (port 0), a new
// one on every restart: binding a port again after giving it up would race
// with every other process picking ports. A forwarder held by the worker
// (support/ports.ts) keeps one address for it, which the web server and the
// tests use.

export interface Stack {
  db: TestDatabase;
  webUrl: string;
  // The worker's API server, at the same address across restarts.
  serverUrl: string;
  token: string;
  reset(): Promise<void>;
  // Restarts the API server with other settings, e.g.
  // without SETUP_TOKEN or with SESSION_* durations; the data stays.
  restartServer(options?: StackServerOptions): Promise<void>;
}

export type StackServerOptions = Pick<ServerOptions, "setupToken" | "env">;

interface WorkerFixtures {
  stack: Stack;
}

interface TestFixtures {
  // biome-ignore lint/suspicious/noConfusingVoidType: an auto fixture without a value, as Playwright documents it
  freshStack: void;
}

function pgServer(): PgServer {
  const raw = process.env[PG_ENV];
  if (!raw) throw new Error(`${PG_ENV} is not set; run the e2e tests through Playwright.`);
  return JSON.parse(raw) as PgServer;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stack: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern
    async ({}, use) => {
      const db = await createDatabase(pgServer(), "e2e");
      const start = (options: StackServerOptions = {}) =>
        startHexmarkServer({
          mode: "dist",
          database: { server: db.server, name: db.name },
          ...options,
        });
      let server: HexmarkServer = await start();
      const forwarder = await startForwarder(server.port);
      const restart = async (options?: StackServerOptions) => {
        server = await start(options);
        forwarder.setTarget(server.port);
      };
      let web: WebServer | undefined;
      try {
        // SERVER_PORT as compose passes it: the MCP address shown with a new
        // API token points at this worker's API server.
        web = await startWebServer(forwarder.url, { SERVER_PORT: String(forwarder.port) });
        await use({
          db,
          webUrl: web.url,
          serverUrl: forwarder.url,
          token: TEST_SETUP_TOKEN,
          async reset() {
            await server.stop();
            await resetSetupData(db);
            await restart();
          },
          async restartServer(options) {
            await server.stop();
            await restart(options);
          },
        });
      } finally {
        await web?.stop();
        await server.stop();
        await forwarder.close();
        await db.drop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.webUrl);
  },
  freshStack: [
    async ({ stack }, use) => {
      await stack.reset();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
