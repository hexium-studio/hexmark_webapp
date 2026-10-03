import { SETUP_RATE_LIMIT } from "../../../config/rate-limits";
import { AttemptGate, type ReservedAttempt } from "../../../lib/attempt-gate";

// Rate limit for setup token attempts (POST /api/setup/v1/verify-token and
// POST /api/setup/v1/create-first-admin); limits in src/config/rate-limits.ts.
//
// Client address (src/services/client-address.ts): the browser's address as
// forwarded by the web server, or the connection's source address for anyone
// else. Two limits apply: per address, and a global one across all addresses,
// so that neither many addresses nor one shared address (e.g. a web server
// that cannot forward addresses) lift the cap on guesses. The global limit
// can lock out the real admin for one window while someone is guessing; that
// is the intended trade-off for a one-time setup.

const gate = new AttemptGate({
  perAddress: SETUP_RATE_LIMIT.perAddress,
  global: SETUP_RATE_LIMIT.global,
  windowMs: SETUP_RATE_LIMIT.windowMinutes * 60 * 1000,
});

export type SetupAttempt = ReservedAttempt;

// Reserves an attempt before any work is done; returns null when the limit is
// reached. Every reserved attempt counts as failed unless released.
export function reserveSetupAttempt(address: string): SetupAttempt | null {
  return gate.reserve(address);
}
