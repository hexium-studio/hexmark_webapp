import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env";

// SETUP_TOKEN as configured in the environment (see src/config/env.ts). The token
// value never leaves this module and is never logged.

export interface SetupTokenState {
  present: boolean;
  configured: boolean;
}

export function getSetupTokenState(): SetupTokenState {
  return { present: env.setupToken.present, configured: env.setupToken.value !== null };
}

// Both sides are hashed to the same length first, so timingSafeEqual always
// gets equal-length buffers and the comparison time does not depend on where
// the inputs differ or on the candidate's length.
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// `candidate` must already be normalised (setupTokenSchema). Returns false
// when no valid token is configured.
export function matchesSetupToken(candidate: string): boolean {
  const expected = env.setupToken.value;
  if (expected === null) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}
