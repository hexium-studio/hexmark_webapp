import { CHALLENGE_LIFETIME_MS, CHALLENGE_MAX_ATTEMPTS } from "../../config/two-factor";
import type { AuthChallenge } from "../../db/schema";

// When a challenge may be used, and what a wrong answer does to it. Pure:
// challenges.ts applies these rules to the row it holds locked.

export type ChallengePurpose = AuthChallenge["purpose"];

export type ChallengeState = Pick<AuthChallenge, "purpose" | "expiresAt" | "usedAt" | "attempts">;

// Usable: of an accepted purpose, not used up, not expired and with tries
// left. A burnt challenge (attempts at the limit) is also marked used, but
// the attempt count alone already refuses it.
export function isChallengeUsable(
  challenge: ChallengeState,
  purposes: readonly ChallengePurpose[],
  now: Date,
): boolean {
  return (
    purposes.includes(challenge.purpose) &&
    challenge.usedAt === null &&
    now.getTime() < challenge.expiresAt.getTime() &&
    challenge.attempts < CHALLENGE_MAX_ATTEMPTS
  );
}

export interface WrongAnswer {
  attempts: number;
  // Tries left; 0 means the challenge is burnt.
  remaining: number;
  burnt: boolean;
}

export function afterWrongAnswer(attempts: number): WrongAnswer {
  const next = Math.min(attempts + 1, CHALLENGE_MAX_ATTEMPTS);
  const remaining = CHALLENGE_MAX_ATTEMPTS - next;
  return { attempts: next, remaining, burnt: remaining === 0 };
}

// End of a new challenge's life. A WebAuthn ceremony started under another
// challenge never outlives it (`notAfter`).
export function challengeExpiry(purpose: ChallengePurpose, now: Date, notAfter?: Date): Date {
  const end = now.getTime() + CHALLENGE_LIFETIME_MS[purpose];
  return new Date(notAfter ? Math.min(end, notAfter.getTime()) : end);
}
