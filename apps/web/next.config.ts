import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Monorepo root: lets standalone output trace workspace packages and the
// pnpm store outside apps/web.
const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Outside Docker (`pnpm dev`), read the repository root .env like the API
// server does. Variables already set in the environment win, so a value on
// the command line overrides the file. Docker images contain no .env.
const rootEnvFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // The built-in translations (messages/<code>/<area>.json) are read from
  // disk at run time (src/lib/locales/catalogue-files.ts), which file
  // tracing cannot see.
  outputFileTracingIncludes: { "/**": ["./messages/**/*.json"] },
  // @hexmark/shared ships TypeScript source without a build step.
  transpilePackages: ["@hexmark/shared"],
  poweredByHeader: false,
  // next dev would otherwise write AGENTS.md and CLAUDE.md into apps/web.
  agentRules: false,
};

// Locale and messages per request; no locale routing (see the file).
const withNextIntl = createNextIntlPlugin("./src/lib/locales/request.ts");

export default withNextIntl(nextConfig);
