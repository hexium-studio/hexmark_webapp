import type { LoginInput, LoginResponse } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { users } from "../../../db/schema";
import { verifyPassword } from "../../../services/password";
import { authUserColumns, createSession } from "../../../services/sessions/sessions";
import { type SignInRefusal, signInRefusal } from "../../../services/sessions/sign-in-policy";
import { reserveLoginAttempt } from "./login-attempts";
import { enrolmentChallenge, secondFactorChallenge } from "./sign-in-challenge";
import { logSignInFailed } from "./sign-in-log";

// Sign-in with e-mail and password. Order: sign-in allowed at all (refused
// while SETUP_TOKEN is set), rate limit, credentials, session. An unknown
// e-mail and a wrong password give the same answer and take the same time:
// both verify a password hash (see verifyPassword). Only those two count as
// failed attempts; they and refusals by the rate limit are logged as
// auth.sign_in_failed (the e-mail itself never).
//
// Whether the password alone is enough is decided by createSession: when the
// account has a second factor, or the instance requires one the account
// lacks, no session is created and the answer is a challenge for the next
// step instead (sign-in-challenge.ts).

export type LoginOutcome =
  | { status: "answered"; response: LoginResponse }
  | { status: "invalid_credentials" }
  | { status: "rate_limited" }
  | { status: "refused"; reason: SignInRefusal };

export interface LoginContext {
  // Source address of the request (for the rate limit).
  address: string;
  userAgent: string | null;
  now: Date;
}

export async function login(input: LoginInput, context: LoginContext): Promise<LoginOutcome> {
  // Answers early without touching credentials; createSession asks again.
  const refusal = signInRefusal();
  if (refusal) return { status: "refused", reason: refusal };
  const attempt = reserveLoginAttempt(context.address);
  if (!attempt) {
    console.warn("Sign-in refused: too many failed attempts (rate limit reached).");
    await logSignInFailed(input.email, "rate_limited");
    return { status: "rate_limited" };
  }
  try {
    const [account] = await getDb()
      .select({ ...authUserColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const matches = await verifyPassword(account?.passwordHash ?? null, input.password);
    if (!account || !matches) {
      await logSignInFailed(input.email, "invalid_credentials", account ?? null);
      return { status: "invalid_credentials" };
    }
    attempt.release();
    const { passwordHash: _, ...user } = account;
    const { remember } = input;
    const created = await createSession(
      {
        userId: user.id,
        remember,
        userAgent: context.userAgent,
        secondFactorVerified: false,
        method: "password",
      },
      context.now,
    );
    const next = { userId: user.id, remember, now: context.now };
    switch (created.status) {
      case "refused":
        return created;
      case "second_factor_required":
        return { status: "answered", response: await secondFactorChallenge(next) };
      case "enrolment_required":
        return { status: "answered", response: await enrolmentChallenge(next) };
      case "created": {
        const { token, expiresAt } = created;
        const session = { token, expiresAt: expiresAt.toISOString(), remember };
        return {
          status: "answered",
          response: { ok: true, status: "signed_in", user, session },
        };
      }
    }
  } catch (error) {
    // A database failure is not a failed guess.
    attempt.release();
    throw error;
  }
}
