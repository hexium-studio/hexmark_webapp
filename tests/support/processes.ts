import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ARTIFACTS_DIR, GUARD_SCRIPT } from "./paths";

// Starting and stopping the processes the tests need. Every process runs
// under tests/support/guard.mjs, which ends it when the test process that
// started it is gone (crash, kill), so nothing keeps running after a test run.

const STOP_TIMEOUT_MS = 10_000;

// A port the operating system just reported as free on 127.0.0.1.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port assigned"));
      });
    });
  });
}

export interface ManagedProcess {
  name: string;
  logFile: string;
  // Last lines of output, for error messages.
  tail(): string;
  exited(): boolean;
  stop(): Promise<void>;
}

const running = new Set<ChildProcess>();

// Synchronous last resort: when the test process exits normally without
// having stopped a process, its guard is told to stop right away.
process.once("exit", () => {
  for (const child of running) child.kill("SIGTERM");
});

export interface StartOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  // Runs once the command is gone, also after a crash of the test process.
  cleanup?: string[];
}

export function startProcess(options: StartOptions): ManagedProcess {
  const logDir = join(ARTIFACTS_DIR, "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${options.name}-${process.pid}-${Date.now()}.log`);
  const log = createWriteStream(logFile);
  const cleanup = options.cleanup ? ["--cleanup", ...options.cleanup, "--"] : [];
  const child = spawn(
    process.execPath,
    [GUARD_SCRIPT, String(process.pid), ...cleanup, "--", options.command, ...options.args],
    { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  running.add(child);
  const lines: string[] = [];
  const collect = (chunk: Buffer) => {
    log.write(chunk);
    lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
    if (lines.length > 40) lines.splice(0, lines.length - 40);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const exit = new Promise<void>((resolve) => {
    child.once("exit", () => {
      running.delete(child);
      log.end();
      resolve();
    });
  });
  return {
    name: options.name,
    logFile,
    tail: () => lines.join("\n"),
    exited: () => child.exitCode !== null || child.signalCode !== null,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return exit;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
      await exit;
      clearTimeout(timer);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `check` until it returns true; fails with the process output when
// the process exits first or time runs out.
export async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  owner: ManagedProcess | undefined,
  timeoutMs = 60_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (owner?.exited()) break;
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    await sleep(100);
  }
  const reason = owner?.exited() ? "the process exited" : `no success within ${timeoutMs} ms`;
  const output = owner ? `\n--- ${owner.name} output (${owner.logFile}) ---\n${owner.tail()}` : "";
  throw new Error(`Waiting for ${what} failed: ${reason}.${output}`);
}

// Environment for a started process: only what it needs, so values from the
// developer's shell or the repository's .env cannot leak into a test.
export function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG", "SystemRoot"];
  const env: NodeJS.ProcessEnv = {};
  for (const name of keep) if (process.env[name] !== undefined) env[name] = process.env[name];
  return { ...env, ...extra };
}
