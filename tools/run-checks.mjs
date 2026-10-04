#!/usr/bin/env node
// Runs the repository's checks one after another, stops at the first
// failure and prints a summary. See tests/README.md.
//
//   node tools/run-checks.mjs all        what CI runs before a merge to main
//                                        (`pnpm test:all`)
//   node tools/run-checks.mjs pre-push   the git pre-push hook
//   node tools/run-checks.mjs release    the gate in .github/workflows/release.yml
//                                        (fast checks only; see tests/README.md)
//
// Docker images are built without being exported or pushed
// (--output type=cacheonly): the build is checked, nothing is left behind
// apart from the build cache.
//
// Every invocation keeps a run directory under tests/.artifacts/runs/ with the
// output of each step (<step>.log), the test reports (<step>.report.json) and
// summary.json; the newest 50 are kept (tests/README.md, "Run logs").

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { openLogSink } from "../tests/support/run-log/output.ts";
import { readReport } from "../tests/support/run-log/reports.ts";
import {
  createRunDir,
  pruneRuns,
  RUN_DIR_ENV,
  RUN_STEP_ENV,
  stepLogFile,
  stepReportFile,
} from "../tests/support/run-log/run-dir.ts";
import {
  buildSummary,
  gitState,
  skippedStep,
  stepRecord,
} from "../tests/support/run-log/summary.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

const STEPS = {
  lint: ["pnpm", "lint"],
  typecheck: ["pnpm", "typecheck"],
  "check:translations": ["pnpm", "check:translations"],
  "check:docs": ["pnpm", "check:docs"],
  build: ["pnpm", "build"],
  "test:unit": ["pnpm", "test:unit"],
  "test:integration": ["pnpm", "test:integration"],
  // Directly, not `pnpm test:e2e`: that would build a second time.
  "test:e2e": ["pnpm", "exec", "playwright", "test", "--config", "tests/e2e/playwright.config.ts"],
  "docker:server": dockerBuild("apps/server/Dockerfile"),
  "docker:web": dockerBuild("apps/web/Dockerfile"),
};

const PROFILES = {
  all: Object.keys(STEPS),
  "pre-push": [
    "lint",
    "typecheck",
    "check:translations",
    "check:docs",
    "test:unit",
    "test:integration",
  ],
  release: ["lint", "typecheck", "check:translations", "check:docs", "test:unit"],
};

function dockerBuild(dockerfile) {
  return ["docker", "build", "--output", "type=cacheonly", "--file", dockerfile, "."];
}

const profile = process.argv[2];
if (!(profile in PROFILES)) {
  console.error(`usage: node tools/run-checks.mjs <${Object.keys(PROFILES).join("|")}>`);
  process.exit(2);
}

const runDir = createRunDir(profile);
pruneRuns();

// Children keep their colours in the terminal although their output is piped
// through this process; the log files get it without them.
const colour = process.stdout.isTTY && !("NO_COLOR" in process.env) ? { FORCE_COLOR: "1" } : {};

// Ctrl+C reaches the running step as well; this process stays to write the
// summary once the step has ended.
process.on("SIGINT", () => {});

function run(name, [command, ...args]) {
  const log = openLogSink(stepLogFile(runDir, name));
  const env = { ...process.env, ...colour, [RUN_DIR_ENV]: runDir, [RUN_STEP_ENV]: name };
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["inherit", "pipe", "pipe"] });
    const toLog = { stdout: log.stream(), stderr: log.stream() };
    for (const stream of ["stdout", "stderr"]) {
      child[stream].on("data", (chunk) => {
        process[stream].write(chunk);
        toLog[stream](chunk);
      });
    }
    const finish = (code, message) => {
      if (message) {
        console.error(message);
        toLog.stderr(`${message}\n`);
      }
      log.close();
      resolve(code);
    };
    child.on("error", (error) => finish(1, `cannot start ${command}: ${error.message}`));
    child.on("close", (code, signal) =>
      finish(signal ? 1 : (code ?? 1), signal ? `${command} ended by ${signal}` : null),
    );
  });
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`.padStart(8);
}

const records = [];
const started = new Date();
for (const name of PROFILES[profile]) {
  console.log(`\n━━━ ${name} ━━━ ${STEPS[name].join(" ")}\n`);
  const stepStart = new Date();
  const exitCode = await run(name, STEPS[name]);
  const reportFile = stepReportFile(runDir, name);
  records.push(
    stepRecord({
      name,
      command: STEPS[name],
      exitCode,
      startedAt: stepStart,
      durationMs: Date.now() - stepStart.getTime(),
      logFile: stepLogFile(runDir, name),
      reportFile,
      report: readReport(reportFile, root),
    }),
  );
  if (exitCode !== 0) break;
}
for (const name of PROFILES[profile].slice(records.length)) {
  records.push(skippedStep(name, STEPS[name]));
}

const summary = buildSummary({
  profile,
  runDir,
  startedAt: started,
  endedAt: new Date(),
  git: gitState(root),
  steps: records,
});
writeFileSync(`${runDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

const shownDir = relative(process.cwd(), runDir) || runDir;
console.log(`\n━━━ ${profile}: summary ━━━`);
for (const { name, status, durationMs } of records) {
  const time = durationMs === null ? "        " : seconds(durationMs);
  console.log(`  ${{ pass: "pass", fail: "FAIL", skip: "skip" }[status]} ${time}  ${name}`);
}
console.log(`  total ${seconds(summary.durationMs)}`);
const failed = records.find((record) => record.status === "fail");
if (failed) {
  console.log(`\n${failed.name} failed: ${STEPS[failed.name].join(" ")}`);
  if (failed.failedTests.length > 0) console.log(`Failed tests (${failed.failedTests.length}):`);
  for (const test of failed.failedTests) console.log(`  ✗ ${test}`);
  if (failed.errors.length > 0) console.log("Errors outside tests:");
  for (const error of failed.errors) console.log(`  ✗ ${error}`);
  console.log(`Logs: ${shownDir}/ (summary.json, ${failed.log})`);
  if (profile === "pre-push") {
    console.log("Push aborted. Fix the failure, or push anyway with `git push --no-verify`.");
  }
  process.exit(1);
}
console.log(`\nAll ${records.length} checks passed. Logs: ${shownDir}/`);
