import { test as base, expect } from "@playwright/test";
import { createDatabase, resetSetupData, type TestDatabase } from "../support/databases";
import {
  type HexmarkServer,
  type ServerOptions,
  startHexmarkServer,
  TEST_SETUP_TOKEN,
} from "../support/hexmark-server";
import type { PgServer } from "../support/postgres-container";
import { startWebServer, type WebServer } from "../support/web-server";
import { PG_ENV } from "./global-setup";

// Fixtures of the e2e tests. Each worker runs a stack of its own: database,
// API server (production bundle) and web server (standalone build). Before
// every test the stack is reset to "setup not done" and the API server is
// restarted on the same port, so attempt counters start at zero too.

export interface Stack {
  db: TestDatabase;
  webUrl: string;
  // The worker's API server; it keeps its port across restarts.
  serverUrl: string;
  token: string;
  reset(): Promise<void>;
  // Restarts the API server on the same port with other settings, e.g.
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
      const start = (port?: number, options: StackServerOptions = {}) =>
        startHexmarkServer({
          mode: "dist",
          database: { server: db.server, name: db.name },
          port,
          ...options,
        });
      let server: HexmarkServer = await start();
      let web: WebServer | undefined;
      try {
        web = await startWebServer(server.url);
        await use({
          db,
          webUrl: web.url,
          serverUrl: server.url,
          token: TEST_SETUP_TOKEN,
          async reset() {
            await server.stop();
            await resetSetupData(db);
            server = await start(server.port);
          },
          async restartServer(options) {
            await server.stop();
            server = await start(server.port, options);
          },
        });
      } finally {
        await web?.stop();
        await server.stop();
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
