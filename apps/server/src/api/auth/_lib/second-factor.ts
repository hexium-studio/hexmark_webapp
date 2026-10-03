import type { SignedInResponse } from "@hexmark/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, type Transaction } from "../../../db/client";
import { type AuthChallenge, totpCredentials } from "../../../db/schema";
import type { Failure, Outcome } from "../../../lib/outcome";
import { completeSignIn } from "../../../services/sessions/complete-sign-in";
import { signInRefusal, signInRefusalFailure } from "../../../services/sessions/sign-in-policy";
import { matchTotp } from "../../../services/totp";
import {
  consumeChallenge,
  lockChallenge,
  recordWrongAnswer,
} from "../../../services/two-factor/challenges";
import { redeemRecoveryCode } from "../../../services/two-factor/recovery-store";
import { refuse } from "../../../services/two-factor/refusals";
import { openTotpSecret } from "../../../services/two-factor/totp-factor";
import { reserveSecondFactorAttempt } from "./second-factor-attempts";

// The second step of signing in: the password was right (login.ts issued a
// second_factor challenge), now a code, a recovery code or a security key
// must be proven before the session starts.
//
// Order: sign-in allowed at all, rate limit per address, then one
// transaction on the locked challenge: check the answer, count a wrong one
// (the last allowed one burns the challenge) or use the challenge up. Only
// wrong answers count against the address limit.

export type Verdict = "right" | "wrong" | Failure;

export interface SignInContext {
  tokenHash: string;
  address: string;
  userAgent: string | null;
  now: Date;
}

// `wrongCode`: the error code of a wrong answer (sent with
// `attemptsRemaining`).
export async function proveSecondFactor(
  context: SignInContext,
  wrongCode: "invalid_code" | "webauthn_failed",
  check: (tx: Transaction, challenge: AuthChallenge) => Promise<Verdict>,
): Promise<Outcome<SignedInResponse>> {
  // Answers early without touching the challenge; createSession asks again.
  const refusal = signInRefusal();
  if (refusal) return signInRefusalFailure(refusal);
  const attempt = reserveSecondFactorAttempt(context.address);
  if (!attempt) return refuse("rate_limited");
  let proven: Outcome<{ userId: string; remember: boolean }>;
  try {
    proven = await getDb().transaction(async (tx) => {
      const challenge = await lockChallenge(tx, context.tokenHash, ["second_factor"], context.now);
      if (!challenge) return refuse("challenge_invalid");
      const verdict = await check(tx, challenge);
      if (verdict === "wrong") {
        const { remaining } = await recordWrongAnswer(tx, challenge, context.now);
        return refuse(wrongCode, { attemptsRemaining: remaining });
      }
      if (verdict !== "right") return verdict;
      await consumeChallenge(tx, challenge.id, context.now);
      return { ok: true, value: { userId: challenge.userId, remember: challenge.remember } };
    });
  } catch (error) {
    attempt.release();
    throw error;
  }
  if (proven.ok || proven.error !== wrongCode) attempt.release();
  if (!proven.ok) return proven;
  return completeSignIn(proven.value, context.userAgent, context.now);
}

// A code from the authenticator app. A step already used (replay) or
// outside the window counts as wrong.
export function checkTotp(code: string, now: Date) {
  return async (tx: Transaction, challenge: AuthChallenge): Promise<Verdict> => {
    const [row] = await tx
      .select()
      .from(totpCredentials)
      .where(
        and(eq(totpCredentials.userId, challenge.userId), isNotNull(totpCredentials.confirmedAt)),
      )
      .for("update");
    if (!row) return refuse("method_unavailable");
    const step = matchTotp(
      openTotpSecret(row.secretEncrypted, row.userId),
      code,
      now,
      row.lastUsedStep,
    );
    if (step === null) return "wrong";
    await tx
      .update(totpCredentials)
      .set({ lastUsedStep: step })
      .where(eq(totpCredentials.id, row.id));
    return "right";
  };
}

// A recovery code (normalized); each one works once.
export function checkRecoveryCode(normalized: string, now: Date) {
  return async (tx: Transaction, challenge: AuthChallenge): Promise<Verdict> =>
    (await redeemRecoveryCode(tx, challenge.userId, normalized, now)) ? "right" : "wrong";
}
