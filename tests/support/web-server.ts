import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TEST_INTERNAL_API_KEY } from "./hexmark-server";
import { ARTIFACTS_DIR, WEB_STANDALONE_DIR, WEB_STATIC_DIR } from "./paths";
import { cleanEnv, freePort, type ManagedProcess, startProcess, waitFor } from "./processes";

// Starts the production build of the web app the way the Docker image runs
// it: the standalone server (apps/web/.next/standalone) with the static
// assets next to it. Needs `pnpm build` first.

export interface WebServer {
  url: string;
  process: ManagedProcess;
  stop(): Promise<void>;
}

// The standalone output does not contain .next/static; the Dockerfile copies
// it in, and so does this (it is build output, ignored by git).
export function prepareStandalone(): void {
  const entry = join(WEB_STANDALONE_DIR, "server.js");
  if (!existsSync(entry) || !existsSync(WEB_STATIC_DIR)) {
    throw new Error("The web build is missing: run `pnpm build` before the e2e tests.");
  }
  cpSync(WEB_STATIC_DIR, join(WEB_STANDALONE_DIR, ".next/static"), { recursive: true });
}

// An empty folder for custom translations, so translations the developer
// keeps in the repository's locales/ never change what the tests see.
export function emptyLocalesDir(): string {
  const dir = join(ARTIFACTS_DIR, "locales-empty");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// `env`: further variables, e.g. TRUSTED_PROXIES, or INTERNAL_API_KEY: ""
// for a web server that cannot forward client addresses.
export async function startWebServer(
  serverUrl: string,
  env: Record<string, string> = {},
): Promise<WebServer> {
  const port = await freePort();
  const proc = startProcess({
    name: `web-${port}`,
    command: process.execPath,
    args: ["server.js"],
    cwd: WEB_STANDALONE_DIR,
    env: cleanEnv({
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      SERVER_INTERNAL_URL: serverUrl,
      HEXMARK_LOCALES_DIR: emptyLocalesDir(),
      INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
      ...env,
    }),
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitFor(
      `the web server on port ${port}`,
      async () => {
        return (await fetch(`${url}/`)).status === 200;
      },
      proc,
    );
  } catch (error) {
    await proc.stop();
    throw error;
  }
  return { url, process: proc, stop: () => proc.stop() };
}
