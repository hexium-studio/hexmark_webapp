import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests in a real Chromium against the production build
// (`pnpm build` first; `pnpm test:e2e` does that). Every worker runs its own
// API server and web server on free ports with its own database in one
// throwaway PostgreSQL container (global-setup.ts, fixtures.ts).
// See tests/README.md.

const artifacts = fileURLToPath(new URL("../.artifacts/e2e/", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: `${artifacts}results`,
  globalSetup: "./global-setup.ts",
  // Every test resets its worker's stack first (fixtures.ts), so tests never
  // share state and may run in any worker, in parallel.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
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
