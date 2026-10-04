import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { ReportResult } from "./reports.ts";

// summary.json of a tools/run-checks.mjs run. It holds what is needed to
// trace a failure afterwards and nothing from the environment: no variables,
// no tokens, only names, times, exit codes and test names.

export interface GitState {
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export interface StepRecord {
  name: string;
  command: string[];
  status: "pass" | "fail" | "skip";
  exitCode: number | null;
  startedAt: string | null;
  durationMs: number | null;
  log: string | null;
  report: string | null;
  tests: Omit<ReportResult, "tool" | "failedTests" | "errors"> | null;
  failedTests: string[];
  errors: string[];
}

export interface RunSummary {
  profile: string;
  status: "pass" | "fail";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  runDir: string;
  git: GitState;
  steps: StepRecord[];
}

export interface FinishedStep {
  name: string;
  command: string[];
  exitCode: number;
  startedAt: Date;
  durationMs: number;
  logFile: string;
  reportFile: string | null;
  report: ReportResult | null;
}

export function stepRecord(step: FinishedStep): StepRecord {
  const report = step.report;
  return {
    name: step.name,
    command: step.command,
    status: step.exitCode === 0 ? "pass" : "fail",
    exitCode: step.exitCode,
    startedAt: step.startedAt.toISOString(),
    durationMs: step.durationMs,
    log: basename(step.logFile),
    report: report && step.reportFile ? basename(step.reportFile) : null,
    tests: report
      ? {
          total: report.total,
          passed: report.passed,
          failed: report.failed,
          skipped: report.skipped,
        }
      : null,
    failedTests: report?.failedTests ?? [],
    errors: report?.errors ?? [],
  };
}

export function skippedStep(name: string, command: string[]): StepRecord {
  return {
    name,
    command,
    status: "skip",
    exitCode: null,
    startedAt: null,
    durationMs: null,
    log: null,
    report: null,
    tests: null,
    failedTests: [],
    errors: [],
  };
}

export function buildSummary(input: {
  profile: string;
  runDir: string;
  startedAt: Date;
  endedAt: Date;
  git: GitState;
  steps: StepRecord[];
}): RunSummary {
  return {
    profile: input.profile,
    status: input.steps.some((step) => step.status === "fail") ? "fail" : "pass",
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    durationMs: input.endedAt.getTime() - input.startedAt.getTime(),
    runDir: input.runDir,
    git: input.git,
    steps: input.steps,
  };
}

export function gitState(cwd: string): GitState {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  };
  const branch = git("rev-parse", "--abbrev-ref", "HEAD")?.trim() || null;
  const status = git("status", "--porcelain");
  return {
    branch,
    commit: git("rev-parse", "HEAD")?.trim() || null,
    dirty: status === null ? null : status.trim() !== "",
  };
}
