import { teeProcessOutput } from "./output.ts";
import {
  createRunDir,
  pruneRuns,
  RUN_DIR_ENV,
  RUN_STEP_ENV,
  stepLogFile,
  stepReportFile,
} from "./run-dir.ts";

// Where a Vitest or Playwright run writes its report. Called from the
// configs (tests/vitest.config.ts, tests/e2e/playwright.config.ts).
//
// Under tools/run-checks.mjs the run directory and the step come from the
// environment, and the runner keeps the console log. A suite started on its
// own (`pnpm test:unit`, `pnpm test:e2e`, ...) creates a run directory of its
// own named after `label`, keeps its console output there itself, and passes
// the directory on through the environment, so that Playwright's workers (which
// load the config again) and the servers the tests start use the same one.

export interface RunOutput {
  runDir: string;
  reportFile: string;
}

export function runOutput(label: string): RunOutput {
  const given = process.env[RUN_DIR_ENV];
  if (given) {
    const step = process.env[RUN_STEP_ENV] || label;
    return { runDir: given, reportFile: stepReportFile(given, step) };
  }
  const runDir = createRunDir(label);
  pruneRuns();
  process.env[RUN_DIR_ENV] = runDir;
  process.env[RUN_STEP_ENV] = label;
  teeProcessOutput(stepLogFile(runDir, label));
  return { runDir, reportFile: stepReportFile(runDir, label) };
}

// The label of a Vitest run from its command line: "test-unit" for
// `--project unit`, "test" for all projects.
export function vitestLabel(argv: readonly string[]): string {
  const projects: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === "--project") projects.push(argv[index + 1] ?? "");
    else if (arg.startsWith("--project=")) projects.push(arg.slice("--project=".length));
  });
  return ["test", ...projects.filter(Boolean)].join("-");
}
