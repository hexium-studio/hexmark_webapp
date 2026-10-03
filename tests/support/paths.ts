import { fileURLToPath } from "node:url";

// Locations in the repository the test support code works with.

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const REPO_ROOT = at("../../");
export const SERVER_DIR = at("../../apps/server/");
export const SERVER_MIGRATIONS = at("../../apps/server/drizzle/");
export const SERVER_DIST_ENTRY = at("../../apps/server/dist/index.js");
export const WEB_DIR = at("../../apps/web/");
// Standalone output mirrors the monorepo layout (apps/web/next.config.ts).
export const WEB_STANDALONE_DIR = at("../../apps/web/.next/standalone/apps/web/");
export const WEB_STATIC_DIR = at("../../apps/web/.next/static/");
export const GUARD_SCRIPT = at("./guard.mjs");
// Logs and other output of test runs; ignored by git and Docker.
export const ARTIFACTS_DIR = at("../.artifacts/");
