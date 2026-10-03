import { and, eq, gt, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { sessions } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { isRecentlyReauthenticated } from "../sessions/reauthentication";
import { lockChallenge } from "./challenges";
import { refuse } from "./refusals";

// Who is changing an account's factors: a signed-in session (account page),
// a sign-in waiting for its first factor (forced enrolment) or the setup
// wizard's ticket. The same factor operations serve all three; only this
// part differs. Every operation starts its transaction with lockActor, so
// the authorisation is checked on the locked row it relies on: a session
// revoked or a ticket used up a moment earlier is refused, not trusted.

export type ActorRef =
  | { kind: "session"; sessionId: string }
  | { kind: "challenge"; tokenHash: string; purpose: "enrolment" | "setup_enrolment" };

export interface LockedActor {
  ref: ActorRef;
  userId: string;
  // Set for challenges: the challenge row (enrolment ends with it).
  challengeId: string | null;
  // "Remember me" carried by an enrolment challenge.
  remember: boolean;
  reauthenticatedAt: Date | null;
}

export async function lockActor(
  tx: Transaction,
  ref: ActorRef,
  now: Date,
): Promise<LockedActor | Failure> {
  if (ref.kind === "session") {
    const [row] = await tx
      .select({ userId: sessions.userId, reauthenticatedAt: sessions.reauthenticatedAt })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, ref.sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .for("share");
    if (!row) return refuse("unauthenticated");
    return { ref, challengeId: null, remember: false, ...row };
  }
  const challenge = await lockChallenge(tx, ref.tokenHash, [ref.purpose], now);
  if (!challenge) return refuse("challenge_invalid");
  return {
    ref,
    userId: challenge.userId,
    challengeId: challenge.id,
    remember: challenge.remember,
    reauthenticatedAt: null,
  };
}

export function isFailure(value: LockedActor | Failure): value is Failure {
  return "ok" in value && value.ok === false;
}

// Sensitive actions: only from a session whose password was re-entered
// recently. Challenges never qualify (they cannot reach these actions).
export function requireRecentReauthentication(actor: LockedActor, now: Date): Failure | null {
  if (actor.ref.kind !== "session") return refuse("reauthentication_required");
  return isRecentlyReauthenticated(actor.reauthenticatedAt, now)
    ? null
    : refuse("reauthentication_required");
}
