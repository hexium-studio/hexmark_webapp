import { CHALLENGE_AUTH_SCHEME, CHALLENGE_TOKEN_PATTERN } from "@hexmark/shared";
import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { CHALLENGE_TOKEN_BYTES } from "../../config/two-factor";
import type { Transaction } from "../../db/client";
import { type AuthChallenge, authChallenges } from "../../db/schema";
import { hashOpaqueToken, newOpaqueToken, readBearerToken } from "../../lib/opaque-token";
import {
  afterWrongAnswer,
  type ChallengePurpose,
  challengeExpiry,
  isChallengeUsable,
  type WrongAnswer,
} from "./challenge-rules";

// Sign-in challenges and setup tickets (auth_challenges): issuing them,
// finding one by its token and holding its row locked while it is used. Every
// decision about a challenge is made on the locked row and written in the
// same transaction, so two requests with one token cannot both use it, and
// wrong answers are counted even when they arrive in parallel.
//
// WebAuthn ceremonies are rows of their own (purpose webauthn_*). Their
// "token" is the WebAuthn challenge the browser signs and sends back, so the
// answer itself names its ceremony; the row is only accepted for the user
// the request is authorised for.

export interface IssuedChallengeRow {
  id: string;
  token: string;
  expiresAt: Date;
}

export interface IssueOptions {
  userId: string;
  purpose: Exclude<ChallengePurpose, "webauthn_registration" | "webauthn_authentication">;
  remember?: boolean;
  now: Date;
}

// Removes the user's challenges that can never be used again, so the table
// does not grow with every sign-in.
async function sweep(tx: Transaction, userId: string, now: Date): Promise<void> {
  await tx
    .delete(authChallenges)
    .where(
      and(
        eq(authChallenges.userId, userId),
        or(lt(authChallenges.expiresAt, now), isNotNull(authChallenges.usedAt)),
      ),
    );
}

export async function issueChallenge(
  tx: Transaction,
  options: IssueOptions,
): Promise<IssuedChallengeRow> {
  await sweep(tx, options.userId, options.now);
  const { token, hash } = newOpaqueToken(CHALLENGE_TOKEN_BYTES);
  const expiresAt = challengeExpiry(options.purpose, options.now);
  const [row] = await tx
    .insert(authChallenges)
    .values({
      userId: options.userId,
      tokenHash: hash,
      purpose: options.purpose,
      remember: options.remember ?? false,
      expiresAt,
      createdAt: options.now,
    })
    .returning({ id: authChallenges.id });
  if (!row) throw new Error("challenge insert returned no row");
  return { id: row.id, token, expiresAt };
}

// The token from an `Authorization: Challenge <token>` header, or null.
export function readChallengeToken(header: string | undefined): string | null {
  return readBearerToken(header, CHALLENGE_AUTH_SCHEME, CHALLENGE_TOKEN_PATTERN);
}

async function lockByHash(tx: Transaction, hash: string): Promise<AuthChallenge | undefined> {
  const [row] = await tx
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.tokenHash, hash))
    .limit(1)
    .for("update");
  return row;
}

// The challenge a token belongs to, locked until the transaction ends; null
// unless it is usable for one of `purposes`.
export async function lockChallenge(
  tx: Transaction,
  tokenHash: string,
  purposes: readonly ChallengePurpose[],
  now: Date,
): Promise<AuthChallenge | null> {
  const row = await lockByHash(tx, tokenHash);
  return row && isChallengeUsable(row, purposes, now) ? row : null;
}

export function challengeTokenHash(token: string): string {
  return hashOpaqueToken(token);
}

export async function consumeChallenge(tx: Transaction, id: string, now: Date): Promise<void> {
  await tx.update(authChallenges).set({ usedAt: now }).where(eq(authChallenges.id, id));
}

// Counts a wrong answer; the last allowed one burns the challenge.
export async function recordWrongAnswer(
  tx: Transaction,
  challenge: AuthChallenge,
  now: Date,
): Promise<WrongAnswer> {
  const result = afterWrongAnswer(challenge.attempts);
  await tx
    .update(authChallenges)
    .set({ attempts: result.attempts, ...(result.burnt ? { usedAt: now } : {}) })
    .where(eq(authChallenges.id, challenge.id));
  return result;
}

export type CeremonyPurpose = "webauthn_registration" | "webauthn_authentication";

// Stores a WebAuthn ceremony's challenge for the user.
export async function issueCeremony(
  tx: Transaction,
  options: {
    userId: string;
    purpose: CeremonyPurpose;
    challenge: string;
    now: Date;
    notAfter?: Date;
  },
): Promise<void> {
  await sweep(tx, options.userId, options.now);
  await tx.insert(authChallenges).values({
    userId: options.userId,
    tokenHash: hashOpaqueToken(options.challenge),
    purpose: options.purpose,
    webauthnChallenge: options.challenge,
    expiresAt: challengeExpiry(options.purpose, options.now, options.notAfter),
    createdAt: options.now,
  });
}

// The ceremony a browser answer refers to (by the challenge it signed),
// locked and consumed: each ceremony is answered once, right or wrong. Null
// when it is unknown, expired, used, of another purpose or another user's.
export async function takeCeremony(
  tx: Transaction,
  options: { userId: string; purpose: CeremonyPurpose; challenge: string; now: Date },
): Promise<AuthChallenge | null> {
  const row = await lockByHash(tx, hashOpaqueToken(options.challenge));
  if (!row || row.userId !== options.userId) return null;
  if (!isChallengeUsable(row, [options.purpose], options.now)) return null;
  await consumeChallenge(tx, row.id, options.now);
  return row;
}
