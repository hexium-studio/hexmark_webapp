#!/usr/bin/env node
// Safety net for processes the tests start (API server, web server,
// PostgreSQL container): runs one command and stops it as soon as the test
// process that asked for it is gone, even when that process was killed
// without a chance to clean up.
//
//   node tests/support/guard.mjs <owner-pid> [--cleanup <cmd> <args...> --] -- <cmd> <args...>
//
// The command runs in this process's own process group. SIGTERM or SIGINT to
// the guard, the command exiting, or the owner disappearing all end the
// command (SIGTERM, then SIGKILL after a grace period) and run the optional
// cleanup command (e.g. `docker rm -f <name>`).

import { spawn, spawnSync } from "node:child_process";

const POLL_MS = 500;
const GRACE_MS = 3_000;

const [ownerArg, ...rest] = process.argv.slice(2);
const owner = Number(ownerArg);
let cleanup = [];
let args = rest;
if (args[0] === "--cleanup") {
  const end = args.indexOf("--", 1);
  cleanup = args.slice(1, end);
  args = args.slice(end + 1);
}
if (args[0] === "--") args = args.slice(1);
if (!Number.isInteger(owner) || args.length === 0) {
  console.error("usage: guard.mjs <owner-pid> [--cleanup <cmd...> --] -- <cmd...>");
  process.exit(2);
}

const child = spawn(args[0], args.slice(1), { stdio: "inherit" });
let stopping = false;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(watch);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), GRACE_MS).unref();
  }
  const finish = () => {
    if (cleanup.length > 0) spawnSync(cleanup[0], cleanup.slice(1), { stdio: "ignore" });
    process.exit(code);
  };
  if (child.exitCode !== null || child.signalCode !== null) finish();
  else child.once("exit", finish);
}

const watch = setInterval(() => {
  if (!alive(owner)) stop(0);
}, POLL_MS);

child.on("exit", (code) => stop(code ?? 1));
child.on("error", (error) => {
  console.error(`guard: cannot start ${args[0]}: ${error.message}`);
  stop(1);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(0));
