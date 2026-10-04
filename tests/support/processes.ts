import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { lineSplitter } from "./lines";
import { ARTIFACTS_DIR, GUARD_SCRIPT } from "./paths";
import { RUN_DIR_ENV } from "./run-log/run-dir.ts";

// Starting and stopping the processes the tests need. Every process runs
// under tests/support/guard.mjs, which ends it when the test process that
// started it is gone (crash, kill), so nothing keeps running after a test run.

const STOP_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ManagedProcess {
  name: string;
  logFile: string;
  // Last lines of output, for error messages.
  tail(): string;
  // The first line of output from now on that matches `pattern`; fails when
  // the process exits first or time runs out.
  waitForLine(what: string, pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>;
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
  // With the other logs of the run (tests/README.md, "Run logs").
  const runDir = process.env[RUN_DIR_ENV];
  const logDir = runDir ? join(runDir, "servers") : join(ARTIFACTS_DIR, "logs");
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
  const watchers = new Set<(line: string | null) => void>();
  const splitters = { stdout: lineSplitter(), stderr: lineSplitter() };
  const take = (received: string[]) => {
    for (const line of received) {
      for (const watcher of watchers) watcher(line);
      if (line.trim()) lines.push(line);
    }
    if (lines.length > 40) lines.splice(0, lines.length - 40);
  };
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream]?.on("data", (chunk: Buffer) => {
      log.write(chunk);
      take(splitters[stream].push(chunk));
    });
  }
  const exit = new Promise<void>((resolve) => {
    child.once("exit", () => {
      running.delete(child);
      resolve();
    });
  });
  // After "exit", once the output is read to its end.
  let closed = false;
  const close = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      take([...splitters.stdout.flush(), ...splitters.stderr.flush()]);
      log.end();
      for (const watcher of watchers) watcher(null);
      resolve();
    });
  });
  const failure = (what: string, reason: string) =>
    new Error(
      `Waiting for ${what} failed: ${reason}.\n--- ${options.name} output (${logFile}) ---\n${lines.join("\n")}`,
    );
  return {
    name: options.name,
    logFile,
    tail: () => lines.join("\n"),
    waitForLine(what, pattern, timeoutMs = 60_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          watchers.delete(watch);
          reject(failure(what, `no such output within ${timeoutMs} ms`));
        }, timeoutMs);
        const watch = (line: string | null) => {
          const match = line === null ? null : line.match(pattern);
          if (line !== null && !match) return;
          watchers.delete(watch);
          clearTimeout(timer);
          if (match) resolve(match);
          else reject(failure(what, "the process exited"));
        };
        if (closed) watch(null);
        else watchers.add(watch);
      });
    },
    exited: () => child.exitCode !== null || child.signalCode !== null,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
        await exit;
        clearTimeout(timer);
      }
      // The last lines, so that tail() is complete afterwards.
      await Promise.race([close, sleep(1_000)]);
    },
  };
}

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
