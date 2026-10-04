import type { AuditAction } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { authChallenges, users } from "../../../db/schema";
import { describeError } from "../../../lib/errors";
import {
  type AuditActor,
  actorOfUser,
  personActor,
  UNKNOWN_PERSON,
} from "../../../services/audit/actor";
import { recordFailure } from "../../../services/audit/record";

// Failed sign-in steps in the audit log, written after the step ended (its
// own writes, such as a counted wrong answer, are already committed or
// rolled back). Attributed to the account when one is known: by the e-mail
// that was entered, or by the sign-in challenge. An e-mail that matches no
// account is never logged; the actor is then "unknown".

async function accountByEmail(email: string): Promise<AuditActor> {
  const [user] = await getDb()
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.email, email));
  return user ? personActor(user) : UNKNOWN_PERSON;
}

async function write(
  action: AuditAction,
  errorCode: string,
  actor: () => Promise<AuditActor>,
  details: Record<string, unknown> = {},
) {
  let who: AuditActor;
  try {
    who = await actor();
  } catch (error) {
    console.error(`Audit event ${action} (failure) not written: ${describeError(error)}`);
    return;
  }
  const target = who.userId ? { kind: "user" as const, id: who.userId, label: who.name } : null;
  await recordFailure({ actor: who, source: "web", action, errorCode, target, details });
}

// invalid_credentials (unknown e-mail or wrong password) or rate_limited.
export function logSignInFailed(
  email: string,
  errorCode: "invalid_credentials" | "rate_limited",
  account?: { id: string; username: string } | null,
): Promise<void> {
  return write("auth.sign_in_failed", errorCode, async () =>
    account ? personActor(account) : accountByEmail(email),
  );
}

// A refused second factor; `userId` when the challenge named the account.
export function logSecondFactorFailed(
  errorCode: string,
  userId: string | null,
  method: string,
): Promise<void> {
  if (userId === null) return Promise.resolve();
  return write("auth.second_factor_verified", errorCode, () => actorOfUser(userId), { method });
}

// The account a sign-in challenge belongs to, without locking it (for
// attributing a refusal that came before the challenge was looked at).
export async function challengeOwner(tokenHash: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ userId: authChallenges.userId })
    .from(authChallenges)
    .where(eq(authChallenges.tokenHash, tokenHash));
  return row?.userId ?? null;
}
