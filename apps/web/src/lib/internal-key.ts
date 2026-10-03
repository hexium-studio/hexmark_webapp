import {
  INTERNAL_KEY_ENV,
  instanceKeyState,
  readInternalKey,
} from "@hexmark/shared/internal-calls";

// INTERNAL_API_KEY from .env, the same value the API server has. The web
// server presents it so that the browser addresses it forwards are believed
// (lib/client-origin/forwarding.ts). Without a valid key, no addresses are
// forwarded and the API server sees every browser as this server's address.
// The key is never logged.

export function internalApiKey(): string | null {
  return readInternalKey();
}

// Start-up log (src/instrumentation.ts), once per process.
export function reportInternalKey(): void {
  const state = instanceKeyState(process.env[INTERNAL_KEY_ENV]);
  if (state === "valid") return;
  console.error(
    `${INTERNAL_KEY_ENV} is ${state}: browser addresses are not forwarded to the API server, ` +
      "which then counts all sign-in attempts as coming from one address. Set it in .env " +
      "(see .env.example) and restart.",
  );
}
