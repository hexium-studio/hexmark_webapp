import { LOGIN_RATE_LIMIT } from "../../../config/rate-limits";
import { AttemptGate, type ReservedAttempt } from "../../../lib/attempt-gate";

// Rate limit for failed sign-ins; limits in src/config/rate-limits.ts.
//
// The address is the browser's, as forwarded by the web server, or the
// connection's source address for anyone else (src/services/client-address.ts).
// A limit per address plus a global one: many addresses cannot lift the cap
// on guesses either. The price is that someone guessing from many addresses
// can block sign-in for everyone for one window; already signed-in users are
// not affected. State is in memory and resets on restart.

const gate = new AttemptGate({
  perAddress: LOGIN_RATE_LIMIT.perAddress,
  global: LOGIN_RATE_LIMIT.global,
  windowMs: LOGIN_RATE_LIMIT.windowMinutes * 60 * 1000,
});

// Null when a limit is reached. The attempt counts as failed unless released.
export function reserveLoginAttempt(address: string): ReservedAttempt | null {
  return gate.reserve(address);
}
