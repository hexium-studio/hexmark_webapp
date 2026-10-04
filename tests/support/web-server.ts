import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TEST_INTERNAL_API_KEY } from "./hexmark-server";
import { ARTIFACTS_DIR, WEB_STANDALONE_DIR, WEB_STATIC_DIR } from "./paths";
import { freePort, LISTEN_HOST } from "./ports";
import { cleanEnv, type ManagedProcess, startProcess, waitFor } from "./processes";

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

// Next.js's standalone server cannot bind port 0 (it reads PORT=0 as
// "unset" and takes 3000), so the port is chosen first, free on the address
// the server then binds (HOSTNAME, LISTEN_HOST in ports.ts). Another process
// can still take it in between; then the server exits with EADDRINUSE and is
// started again on a new port.
const START_ATTEMPTS = 5;
const ADDRESS_IN_USE = /\bEADDRINUSE\b/;

// `env`: further variables, e.g. TRUSTED_PROXIES, or INTERNAL_API_KEY: ""
// for a web server that cannot forward client addresses.
export async function startWebServer(
  serverUrl: string,
  env: Record<string, string> = {},
): Promise<WebServer> {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const proc = startProcess({
      name: "web",
      command: process.execPath,
      args: ["server.js"],
      cwd: WEB_STANDALONE_DIR,
      env: cleanEnv({
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(port),
        HOSTNAME: LISTEN_HOST,
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
        async () => (await fetch(`${url}/`)).status === 200,
        proc,
      );
      return { url, process: proc, stop: () => proc.stop() };
    } catch (error) {
      await proc.stop();
      if (!ADDRESS_IN_USE.test(proc.tail()) || attempt === START_ATTEMPTS) throw error;
    }
  }
}
