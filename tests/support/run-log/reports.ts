import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { stripAnsi } from "./ansi.ts";

// Reads the JSON report of a Vitest or Playwright run and returns the counts
// and the names of the failed tests, as "<file> > <describe> > <test>".

export interface ReportResult {
  tool: "vitest" | "playwright";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failedTests: string[];
  // Errors outside any test (a file that cannot load, a failing global setup).
  errors: string[];
}

export function readReport(file: string, root: string): ReportResult | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  return parseReport(data, root);
}

export function parseReport(data: unknown, root: string): ReportResult | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray((data as VitestReport).testResults)) {
    return fromVitest(data as VitestReport, root);
  }
  if (Array.isArray((data as PlaywrightReport).suites)) {
    return fromPlaywright(data as PlaywrightReport, root);
  }
  return null;
}

interface VitestReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults?: { ancestorTitles?: string[]; title: string; status: string }[];
  }[];
}

function fromVitest(report: VitestReport, root: string): ReportResult {
  const failedTests: string[] = [];
  const errors: string[] = [];
  for (const file of report.testResults) {
    const name = shortPath(file.name, root);
    const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    for (const test of failed) {
      failedTests.push([name, ...(test.ancestorTitles ?? []), test.title].join(" > "));
    }
    if (file.status === "failed" && failed.length === 0) {
      errors.push(`${name}: ${firstLine(file.message) || "failed outside a test"}`);
    }
  }
  return {
    tool: "vitest",
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? failedTests.length,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    failedTests,
    errors,
  };
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: {
    title: string;
    file?: string;
    tests: { status: string; projectName?: string }[];
  }[];
}

interface PlaywrightReport {
  // Spec files are named relative to the test directory, config.rootDir.
  config?: { rootDir?: string };
  suites: PlaywrightSuite[];
  errors?: { message?: string }[];
}

function fromPlaywright(report: PlaywrightReport, root: string): ReportResult {
  const result: ReportResult = {
    tool: "playwright",
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failedTests: [],
    errors: (report.errors ?? []).map((error) => firstLine(error.message) || "error"),
  };
  // `path` holds the describe titles; the top-level suite of a file is titled
  // with the file name and is left out.
  const visit = (suite: PlaywrightSuite, path: string[]) => {
    for (const child of suite.suites ?? []) visit(child, [...path, child.title]);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        result.total++;
        // "flaky" (failed, then passed on a retry) cannot happen with
        // retries: 0; it would count as passed.
        if (test.status === "skipped") result.skipped++;
        else if (test.status !== "unexpected") result.passed++;
        else {
          result.failed++;
          const name = spec.file ?? suite.file ?? "";
          const testDir = report.config?.rootDir;
          const file = shortPath(testDir && name ? join(testDir, name) : name, root);
          result.failedTests.push([file, ...path, spec.title].filter(Boolean).join(" > "));
        }
      }
    }
  };
  for (const suite of report.suites) visit(suite, []);
  return result;
}

function shortPath(file: string, root: string): string {
  return isAbsolute(file) ? relative(root, file) : file;
}

function firstLine(text: string | undefined): string {
  return (
    stripAnsi(text ?? "")
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}
