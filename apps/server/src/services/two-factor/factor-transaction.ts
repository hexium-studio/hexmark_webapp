import { type AuditAction, mayRemoveFactor } from "@hexmark/shared";
import { getDb, type Transaction } from "../../db/client";
import type { Failure, Outcome } from "../../lib/outcome";
import { type AuditActor, personActor } from "../audit/actor";
import { type AuditTarget, recordEvent, recordFailure } from "../audit/record";
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
// adding or removing one applies them the same way. The audit log is part
// of the frame: the operation logs its success through scope.record in the
// transaction; a refusal is logged here once the transaction has ended
// (refusals here write nothing, except that a WebAuthn ceremony is used up).

export interface FactorScope {
  tx: Transaction;
  actor: LockedActor;
  requireTwoFactor: boolean;
  before: FactorCounts;
  // Logs the operation's success in this transaction (the action given to
  // withFactorScope, for the account's owner).
  record(event?: { target?: AuditTarget; details?: Record<string, unknown> }): Promise<void>;
}

export interface FactorOptions {
  reauthenticate?: boolean;
  settings?: "share" | "update";
  // What the operation is logged as; a refusal is logged with it as well.
  action: AuditAction;
}

// Where the change was made: the account page, forced enrolment at sign-in,
// or the setup wizard.
function factorContext(ref: ActorRef): string {
  if (ref.kind === "session") return "account";
  return ref.purpose === "enrolment" ? "sign_in_enrolment" : "setup";
}

export async function withFactorScope<T>(
  ref: ActorRef,
  now: Date,
  options: FactorOptions,
  work: (scope: FactorScope) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  const { action } = options;
  let person: AuditActor | null = null;
  const outcome = await getDb().transaction(async (tx) => {
    const actor = await lockActor(tx, ref, now);
    if (isFailure(actor)) return actor;
    const owner = await lockFactorOwner(tx, actor.userId, {
      settings: options.settings ?? "share",
      user: "update",
    });
    if (!owner) return refuse(ref.kind === "session" ? "unauthenticated" : "challenge_invalid");
    const who = personActor({ id: actor.userId, username: owner.username });
    person = who;
    if (options.reauthenticate) {
      const refusal = requireRecentReauthentication(actor, now);
      if (refusal) return refusal;
    }
    const before = await countFactors(tx, actor.userId);
    const userTarget: AuditTarget = { kind: "user", id: who.userId, label: who.name };
    const record: FactorScope["record"] = (event = {}) =>
      recordEvent(
        tx,
        {
          actor: who,
          source: "web",
          action,
          target: event.target ?? userTarget,
          details: { context: factorContext(ref), ...event.details },
        },
        now,
      );
    return work({ tx, actor, requireTwoFactor: owner.requireTwoFactor, before, record });
  });
  // Refused: logged after the transaction, for the account when known.
  const refusedFor = person as AuditActor | null;
  if (!outcome.ok && refusedFor) {
    await recordFailure({
      actor: refusedFor,
      source: "web",
      action,
      errorCode: outcome.error,
      target: { kind: "user", id: refusedFor.userId, label: refusedFor.name },
      details: { context: factorContext(ref) },
    });
  }
  return outcome;
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
