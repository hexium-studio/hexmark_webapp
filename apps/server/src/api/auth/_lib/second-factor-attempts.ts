import { SECOND_FACTOR_RATE_LIMIT } from "../../../config/rate-limits";
import { AttemptGate, type ReservedAttempt } from "../../../lib/attempt-gate";

// Rate limit for wrong second-factor answers at sign-in, per client address
// and across all addresses (limits in src/config/rate-limits.ts). It comes on
// top of the limit of each challenge (CHALLENGE_MAX_ATTEMPTS): a new sign-in
// brings a new challenge, but not new attempts here. State is in memory and
// resets on restart, like the sign-in limit (login-attempts.ts).

const gate = new AttemptGate({
  perAddress: SECOND_FACTOR_RATE_LIMIT.perAddress,
  global: SECOND_FACTOR_RATE_LIMIT.global,
  windowMs: SECOND_FACTOR_RATE_LIMIT.windowMinutes * 60 * 1000,
});

// Null when a limit is reached. The attempt counts as failed unless released.
export function reserveSecondFactorAttempt(address: string): ReservedAttempt | null {
  return gate.reserve(address);
}
