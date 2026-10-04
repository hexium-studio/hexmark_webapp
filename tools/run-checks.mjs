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

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function run([command, ...args]) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`cannot start ${command}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`.padStart(8);
}

const results = [];
const started = Date.now();
for (const name of PROFILES[profile]) {
  console.log(`\n━━━ ${name} ━━━ ${STEPS[name].join(" ")}\n`);
  const stepStart = Date.now();
  const code = await run(STEPS[name]);
  results.push({ name, ok: code === 0, ms: Date.now() - stepStart });
  if (code !== 0) break;
}

const failed = results.find((result) => !result.ok);
const skipped = PROFILES[profile].slice(results.length);
console.log(`\n━━━ ${profile}: summary ━━━`);
for (const { name, ok, ms } of results)
  console.log(`  ${ok ? "pass" : "FAIL"} ${seconds(ms)}  ${name}`);
for (const name of skipped) console.log(`  skip           ${name}`);
console.log(`  total ${seconds(Date.now() - started)}`);
if (failed) {
  console.log(`\n${failed.name} failed: ${STEPS[failed.name].join(" ")}`);
  if (profile === "pre-push") {
    console.log("Push aborted. Fix the failure, or push anyway with `git push --no-verify`.");
  }
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed.`);
