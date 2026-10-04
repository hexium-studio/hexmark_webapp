import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// One directory per test run under tests/.artifacts/runs/, named
// <UTC time>-<label>, e.g. 2026-10-04T09-15-02Z-pre-push. tools/run-checks.mjs
// creates one per invocation and hands it to its steps; a suite started on its
// own creates its own. See tests/README.md, "Run logs".

export const RUNS_DIR = fileURLToPath(new URL("../../.artifacts/runs/", import.meta.url));

// The run directory of the current run, set for every process below it.
export const RUN_DIR_ENV = "HEXMARK_TEST_RUN_DIR";
// The name of the tools/run-checks.mjs step a suite runs in.
export const RUN_STEP_ENV = "HEXMARK_TEST_STEP";

// Run directories kept; older ones are removed when a new run starts.
export const RUNS_KEPT = 50;

const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-/;

export function runDirName(now: Date, label: string): string {
  const time = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
  return `${time}-${slug(label)}`;
}

// "test:unit" -> "test-unit"; the file name part of a step or label.
export function slug(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

export function stepLogFile(runDir: string, step: string): string {
  return join(runDir, `${slug(step)}.log`);
}

export function stepReportFile(runDir: string, step: string): string {
  return join(runDir, `${slug(step)}.report.json`);
}

// Creates a new run directory below `runsDir`; a second run started in the
// same second gets a numbered name instead of sharing the directory.
export function createRunDir(label: string, now = new Date(), runsDir = RUNS_DIR): string {
  mkdirSync(runsDir, { recursive: true });
  const base = runDirName(now, label);
  for (let attempt = 1; ; attempt++) {
    const dir = join(runsDir, attempt === 1 ? base : `${base}-${attempt}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

// Removes all but the newest `keep` run directories (by name, which sorts by
// time). Anything else in `runsDir` is left alone. Returns the removed names.
export function pruneRuns(runsDir = RUNS_DIR, keep = RUNS_KEPT): string[] {
  let names: string[];
  try {
    names = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const removed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of removed) rmSync(join(runsDir, name), { recursive: true, force: true });
  return removed;
}
