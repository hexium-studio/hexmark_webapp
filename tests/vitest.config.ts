import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { runOutput, vitestLabel } from "./support/run-log/config.ts";

// Unit and integration tests (Vitest). E2E tests use Playwright
// (tests/e2e/playwright.config.ts). See tests/README.md.

const webSrc = fileURLToPath(new URL("../apps/web/src/", import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));
// Every test with its status, duration and failure (message and stack) as
// JSON in the run directory, next to the console output (tests/README.md,
// "Run logs").
const { reportFile } = runOutput(vitestLabel(process.argv));

export default defineConfig({
  root,
  resolve: {
    // The web app's import alias, for unit tests of its pure modules.
    alias: [{ find: /^@\//, replacement: webSrc }],
  },
  test: {
    reporters: ["default", ["json", { outputFile: reportFile }]],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // One PostgreSQL container for the whole run (global-setup.ts).
          // Each file gets its own database and API server, so files run in
          // parallel; tests inside a file run one after another.
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 90_000,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
