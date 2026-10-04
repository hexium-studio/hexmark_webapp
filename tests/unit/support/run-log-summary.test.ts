import { describe, expect, it } from "vitest";
import { parseReport } from "../../support/run-log/reports.ts";
import { buildSummary, skippedStep, stepRecord } from "../../support/run-log/summary.ts";

// Reading the failed tests out of Vitest's and Playwright's JSON reports, and
// building summary.json of a tools/run-checks.mjs run.

const ROOT = "/repo";
const ESC = "\x1b";

const vitestReport = {
  numTotalTests: 4,
  numPassedTests: 2,
  numFailedTests: 1,
  numPendingTests: 1,
  numTodoTests: 0,
  success: false,
  testResults: [
    {
      name: "/repo/tests/integration/notes.test.ts",
      status: "failed",
      message: "",
      assertionResults: [
        { ancestorTitles: ["notes API"], title: "creates a note", status: "passed" },
        {
          ancestorTitles: ["notes API", "titles"],
          title: "refuses a taken title",
          status: "failed",
          failureMessages: ["AssertionError: expected 409\n    at notes.test.ts:12:3"],
        },
        { ancestorTitles: [], title: "later", status: "skipped" },
      ],
    },
    { name: "/repo/tests/integration/ok.test.ts", status: "passed", assertionResults: [] },
    {
      name: "/repo/tests/integration/broken.test.ts",
      status: "failed",
      message: `\n${ESC}[31mSyntaxError: Unexpected token${ESC}[39m\n    at broken.test.ts:1:1`,
      assertionResults: [],
    },
  ],
};

const playwrightReport = {
  config: { rootDir: "/repo/tests/e2e" },
  suites: [
    {
      title: "token.spec.ts",
      file: "token.spec.ts",
      specs: [{ title: "top level test", file: "token.spec.ts", tests: [{ status: "expected" }] }],
      suites: [
        {
          title: "API tokens",
          file: "token.spec.ts",
          specs: [
            { title: "creates a token", file: "token.spec.ts", tests: [{ status: "unexpected" }] },
            { title: "is skipped", file: "token.spec.ts", tests: [{ status: "skipped" }] },
            { title: "passes on retry", file: "token.spec.ts", tests: [{ status: "flaky" }] },
          ],
        },
      ],
    },
  ],
  errors: [{ message: `${ESC}[31mError: global setup failed${ESC}[39m\n  at global-setup.ts` }],
};

describe("parseReport", () => {
  it("lists failed Vitest tests with their file, and files that failed outside a test", () => {
    expect(parseReport(vitestReport, ROOT)).toEqual({
      tool: "vitest",
      total: 4,
      passed: 2,
      failed: 1,
      skipped: 1,
      failedTests: ["tests/integration/notes.test.ts > notes API > titles > refuses a taken title"],
      errors: ["tests/integration/broken.test.ts: SyntaxError: Unexpected token"],
    });
  });

  it("lists failed Playwright tests with file and describe titles, and global errors", () => {
    expect(parseReport(playwrightReport, ROOT)).toEqual({
      tool: "playwright",
      total: 4,
      passed: 2,
      failed: 1,
      skipped: 1,
      failedTests: ["tests/e2e/token.spec.ts > API tokens > creates a token"],
      errors: ["Error: global setup failed"],
    });
  });

  it("returns null for anything that is not one of the two reports", () => {
    expect(parseReport(null, ROOT)).toBeNull();
    expect(parseReport({ some: "json" }, ROOT)).toBeNull();
    expect(parseReport("text", ROOT)).toBeNull();
  });
});

describe("summary.json", () => {
  const started = new Date("2026-10-04T09:00:00Z");
  const git = { branch: "dev", commit: "abc123", dirty: true };

  it("records each step, the failed tests of the failed one and the skipped rest", () => {
    const lint = stepRecord({
      name: "lint",
      command: ["pnpm", "lint"],
      exitCode: 0,
      startedAt: started,
      durationMs: 1500,
      logFile: "/runs/r/lint.log",
      reportFile: "/runs/r/lint.report.json",
      report: null,
    });
    const integration = stepRecord({
      name: "test:integration",
      command: ["pnpm", "test:integration"],
      exitCode: 1,
      startedAt: new Date("2026-10-04T09:00:02Z"),
      durationMs: 30_000,
      logFile: "/runs/r/test-integration.log",
      reportFile: "/runs/r/test-integration.report.json",
      report: parseReport(vitestReport, ROOT),
    });
    const summary = buildSummary({
      profile: "pre-push",
      runDir: "/runs/r",
      startedAt: started,
      endedAt: new Date("2026-10-04T09:00:33Z"),
      git,
      steps: [lint, integration, skippedStep("test:e2e", ["pnpm", "test:e2e"])],
    });

    expect(summary).toMatchObject({
      profile: "pre-push",
      status: "fail",
      startedAt: "2026-10-04T09:00:00.000Z",
      endedAt: "2026-10-04T09:00:33.000Z",
      durationMs: 33_000,
      git,
    });
    expect(summary.steps[0]).toMatchObject({ status: "pass", log: "lint.log", report: null });
    expect(summary.steps[1]).toMatchObject({
      status: "fail",
      exitCode: 1,
      log: "test-integration.log",
      report: "test-integration.report.json",
      tests: { total: 4, passed: 2, failed: 1, skipped: 1 },
      failedTests: ["tests/integration/notes.test.ts > notes API > titles > refuses a taken title"],
    });
    expect(summary.steps[2]).toMatchObject({ status: "skip", exitCode: null, log: null });
  });

  it("passes when no step failed, and holds nothing from the environment", () => {
    const summary = buildSummary({
      profile: "release",
      runDir: "/runs/r",
      startedAt: started,
      endedAt: started,
      git: { branch: null, commit: null, dirty: null },
      steps: [skippedStep("lint", ["pnpm", "lint"])],
    });
    expect(summary.status).toBe("pass");
    expect(Object.keys(summary).sort()).toEqual(
      ["durationMs", "endedAt", "git", "profile", "runDir", "startedAt", "status", "steps"].sort(),
    );
    const text = JSON.stringify(summary);
    for (const value of Object.values(process.env)) {
      if (value && value.length > 12) expect(text).not.toContain(value);
    }
  });
});
