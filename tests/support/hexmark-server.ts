import { existsSync } from "node:fs";
import { SERVER_DIR, SERVER_DIST_ENTRY } from "./paths";
import type { PgServer } from "./postgres-container";
import { cleanEnv, freePort, type ManagedProcess, startProcess, waitFor } from "./processes";

// Starts the Hexmark API server (apps/server) as its own process with its
// own port, database and SETUP_TOKEN. Each instance has its own in-memory
// rate limiter, so a fresh instance means fresh attempt counters.

// Valid token used by the tests (8 characters, A-Z and 0-9).
export const TEST_SETUP_TOKEN = "TEST2345";

export interface ServerOptions {
  // "source" runs src/index.ts through tsx (no build needed); "dist" runs
  // the production bundle from `pnpm build`.
  mode: "source" | "dist";
  database?: { server: PgServer; name: string };
  // Overrides the database settings, e.g. a port nobody listens on.
  databaseEnv?: Record<string, string>;
  // undefined: TEST_SETUP_TOKEN; null: SETUP_TOKEN not set at all.
  setupToken?: string | null;
  // Wait until migrations are applied (GET /api/setup/v1/status answers 200).
  waitForDatabase?: boolean;
  port?: number;
}

export interface HexmarkServer {
  url: string;
  port: number;
  process: ManagedProcess;
  stop(): Promise<void>;
}

function databaseEnv(options: ServerOptions): Record<string, string> {
  if (options.databaseEnv) return options.databaseEnv;
  if (!options.database) return {};
  const { server, name } = options.database;
  return {
    POSTGRES_USER: server.user,
    POSTGRES_PASSWORD: server.password,
    POSTGRES_DB: name,
    DB_HOST: server.host,
    DB_PORT: String(server.port),
  };
}

export async function startHexmarkServer(options: ServerOptions): Promise<HexmarkServer> {
  if (options.mode === "dist" && !existsSync(SERVER_DIST_ENTRY)) {
    throw new Error("apps/server/dist is missing: run `pnpm build` before the e2e tests.");
  }
  const port = options.port ?? (await freePort());
  const token = options.setupToken === undefined ? TEST_SETUP_TOKEN : options.setupToken;
  const env = cleanEnv({
    NODE_ENV: "production",
    PORT: String(port),
    ...databaseEnv(options),
    ...(token === null ? {} : { SETUP_TOKEN: token }),
  });
  // tsx is loaded as an import hook; Node resolves it from the working
  // directory, apps/server, where it is installed.
  const args =
    options.mode === "source" ? ["--import", "tsx", "src/index.ts"] : [SERVER_DIST_ENTRY];
  const proc = startProcess({
    name: `server-${port}`,
    command: process.execPath,
    args,
    cwd: SERVER_DIR,
    env,
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => proc.stop();
  try {
    await waitFor(
      `the API server on port ${port}`,
      async () => {
        return (await fetch(`${url}/health`)).ok;
      },
      proc,
    );
    if (options.waitForDatabase ?? true) {
      await waitFor(
        "the API server's migrations",
        async () => {
          return (await fetch(`${url}/api/setup/v1/status`)).status === 200;
        },
        proc,
      );
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, port, process: proc, stop };
}
