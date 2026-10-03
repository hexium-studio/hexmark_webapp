import { mayRemoveFactor } from "@hexmark/shared";
import { getDb, type Transaction } from "../../db/client";
import type { Failure, Outcome } from "../../lib/outcome";
import {
  type ActorRef,
  isFailure,
  type LockedActor,
  lockActor,
  requireRecentReauthentication,
} from "./actor";
import { countFactors, type FactorCounts, hasAnyFactor, lockFactorOwner } from "./factor-state";
import { deleteRecoveryCodes, issueRecoveryCodes } from "./recovery-store";
import { refuse } from "./refusals";

// The frame of every operation that changes an account's factors: one
// transaction that locks, in this order, the actor (actor.ts), the instance
// settings and the user's row (factor-state.ts), and only then reads and
// writes factors. The rules that span factors live here, so every way of
// adding or removing one applies them the same way.

export interface FactorScope {
  tx: Transaction;
  actor: LockedActor;
  requireTwoFactor: boolean;
  before: FactorCounts;
}

export async function withFactorScope<T>(
  ref: ActorRef,
  now: Date,
  options: { reauthenticate?: boolean; settings?: "share" | "update" },
  work: (scope: FactorScope) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  return getDb().transaction(async (tx) => {
    const actor = await lockActor(tx, ref, now);
    if (isFailure(actor)) return actor;
    if (options.reauthenticate) {
      const refusal = requireRecentReauthentication(actor, now);
      if (refusal) return refusal;
    }
    const owner = await lockFactorOwner(tx, actor.userId, {
      settings: options.settings ?? "share",
      user: "update",
    });
    if (!owner) return refuse(ref.kind === "session" ? "unauthenticated" : "challenge_invalid");
    const before = await countFactors(tx, actor.userId);
    return work({ tx, actor, requireTwoFactor: owner.requireTwoFactor, before });
  });
}

// Called after a factor was added: the first factor of an account comes
// with a fresh set of recovery codes (returned once); later ones do not.
export async function recoveryCodesForNewFactor(scope: FactorScope, now: Date) {
  if (hasAnyFactor(scope.before)) return null;
  return issueRecoveryCodes(scope.tx, scope.actor.userId, now);
}

// Whether a factor may go, given what would be left. While the instance
// requires a second factor, the last one stays.
export function checkRemoval(scope: FactorScope, after: FactorCounts): Failure | null {
  if (!mayRemoveFactor(scope.requireTwoFactor, after)) return refuse("last_factor_required");
  return null;
}

// Called after a factor was removed: without any factor, recovery codes have
// nothing to stand in for and are deleted (a new first factor brings new ones).
export async function afterFactorRemoved(scope: FactorScope, after: FactorCounts): Promise<void> {
  if (!hasAnyFactor(after)) await deleteRecoveryCodes(scope.tx, scope.actor.userId);
}
