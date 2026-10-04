import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { runOutput } from "../support/run-log/config.ts";

// End-to-end tests in a real Chromium against the production build
// (`pnpm build` first; `pnpm test:e2e` does that). Every worker runs its own
// API server and web server on free ports with its own database in one
// throwaway PostgreSQL container (global-setup.ts, fixtures.ts).
// See tests/README.md.

// The report (every test with status, duration, errors and output) and the
// traces and screenshots of failed tests go to the run directory, so a later
// run does not replace them (tests/README.md, "Run logs").
const { runDir, reportFile } = runOutput("test-e2e");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: join(runDir, "e2e-results"),
  globalSetup: "./global-setup.ts",
  // Every test resets its worker's stack first (fixtures.ts), so tests never
  // share state and may run in any worker, in parallel.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  // No retries, in CI either: a failure is a bug to find, not to hide as
  // "flaky" (tests/README.md, "No retries").
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: reportFile }]],
  use: {
    ...devices["Desktop Chrome"],
    // The full Chromium in its new headless mode, not the headless shell:
    // the layer measurements (layers.spec.ts) need the real compositor.
    channel: "chromium",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
