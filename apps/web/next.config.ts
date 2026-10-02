import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Monorepo root: lets standalone output trace workspace packages and the
// pnpm store outside apps/web.
const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // @hexmark/shared ships TypeScript source without a build step.
  transpilePackages: ["@hexmark/shared"],
  poweredByHeader: false,
  // next dev would otherwise write AGENTS.md and CLAUDE.md into apps/web.
  agentRules: false,
};

export default nextConfig;
