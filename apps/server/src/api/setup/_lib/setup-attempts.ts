import { SETUP_RATE_LIMIT } from "../../../config/rate-limits";
import { AttemptLimiter } from "../../../lib/rate-limiter";

// Rate limit for setup token attempts (POST /api/setup/v1/verify-token and
// POST /api/setup/v1/create-first-admin); limits in src/config/rate-limits.ts.
//
// Client address: setup requests reach this server from the Next.js server,
// not from the browser, so the connection's source address is usually the web
// container for every user. X-Forwarded-For is deliberately not trusted (any
// client that reaches port 3001 directly could set it). Instead there are two
// limits: per source address, and a global one across all addresses, so that
// neither a shared proxy address nor many addresses lift the cap on guesses.
// The global limit can lock out the real admin for one window while someone
// is guessing; that is the intended trade-off for a one-time setup.

const WINDOW_MS = SETUP_RATE_LIMIT.windowMinutes * 60 * 1000;
const perAddress = new AttemptLimiter({ max: SETUP_RATE_LIMIT.perAddress, windowMs: WINDOW_MS });
const overall = new AttemptLimiter({ max: SETUP_RATE_LIMIT.global, windowMs: WINDOW_MS });
const OVERALL_KEY = "*";

export interface SetupAttempt {
  // The attempt was not a failed token guess: stop counting it.
  release(): void;
}

// Reserves an attempt before any work is done; returns null when the limit is
// reached. Every reserved attempt counts as failed unless released, so
// requests running in parallel are counted from the start.
export function reserveSetupAttempt(address: string): SetupAttempt | null {
  if (!perAddress.tryAcquire(address)) return null;
  if (!overall.tryAcquire(OVERALL_KEY)) {
    perAddress.release(address);
    return null;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      perAddress.release(address);
      overall.release(OVERALL_KEY);
    },
  };
}
