import type { TotpStartResponse } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { TOTP_ISSUER } from "../../config/two-factor";
import { totpCredentials, users } from "../../db/schema";
import { decrypt, encrypt } from "../../lib/crypto";
import { type Outcome, succeed } from "../../lib/outcome";
import { base32Decode, base32Encode, matchTotp, newTotpSecret, totpUri } from "../totp";
import type { ActorRef } from "./actor";
import { consumeChallenge } from "./challenges";
import {
  afterFactorRemoved,
  checkRemoval,
  type FactorScope,
  recoveryCodesForNewFactor,
  withFactorScope,
} from "./factor-transaction";
import { encryptionKeyring } from "./keyring";
import { refuse } from "./refusals";

// Adding and removing the authenticator app (TOTP). Setting it up takes two
// steps: start stores a new secret as pending (confirmed_at null) and hands
// it out once; confirm checks a code from the app and only then makes it a
// factor. The secret is stored encrypted with ENCRYPTION_KEY, bound to the
// user's id (src/lib/crypto.ts), as base32 text.

// Seals and opens TOTP secrets; the user id is the context, so a secret
// copied to another user's row does not open.
export function sealTotpSecret(secret: Buffer, userId: string): string {
  return encrypt(base32Encode(secret), encryptionKeyring(), userId);
}

export function openTotpSecret(sealed: string, userId: string): Buffer {
  const secret = base32Decode(decrypt(sealed, encryptionKeyring(), userId));
  if (!secret) throw new Error("stored TOTP secret is not base32");
  return secret;
}

async function currentTotp(scope: FactorScope) {
  const [row] = await scope.tx
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, scope.actor.userId));
  return row;
}

export function startTotp(ref: ActorRef, now: Date): Promise<Outcome<TotpStartResponse>> {
  return withFactorScope(ref, now, {}, async (scope) => {
    if (scope.before.totp) return refuse("totp_already_enabled");
    const userId = scope.actor.userId;
    const [user] = await scope.tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const secret = newTotpSecret();
    const secretEncrypted = sealTotpSecret(secret, userId);
    // A pending set-up started earlier is replaced; its secret is gone.
    await scope.tx
      .insert(totpCredentials)
      .values({ userId, secretEncrypted, createdAt: now })
      .onConflictDoUpdate({
        target: totpCredentials.userId,
        set: { secretEncrypted, confirmedAt: null, lastUsedStep: null, createdAt: now },
      });
    return succeed({
      secret: base32Encode(secret),
      otpauthUri: totpUri(secret, TOTP_ISSUER, user?.email ?? userId),
    });
  });
}

export interface FactorAdded {
  userId: string;
  recoveryCodes: string[] | null;
  // The actor was a forced enrolment, which this factor completes.
  completesEnrolment: boolean;
  remember: boolean;
}

// Ends a forced enrolment with its first factor: the challenge is used up
// in the same transaction that added the factor.
export async function finishEnrolment(scope: FactorScope, now: Date): Promise<boolean> {
  const { actor } = scope;
  if (actor.ref.kind !== "challenge" || actor.ref.purpose !== "enrolment") return false;
  if (actor.challengeId) await consumeChallenge(scope.tx, actor.challengeId, now);
  return true;
}

export function confirmTotp(ref: ActorRef, code: string, now: Date): Promise<Outcome<FactorAdded>> {
  return withFactorScope(ref, now, {}, async (scope) => {
    const row = await currentTotp(scope);
    if (row?.confirmedAt) return refuse("totp_already_enabled");
    if (!row) return refuse("totp_not_pending");
    const secret = openTotpSecret(row.secretEncrypted, row.userId);
    const step = matchTotp(secret, code, now, row.lastUsedStep);
    if (step === null) return refuse("invalid_code");
    await scope.tx
      .update(totpCredentials)
      .set({ confirmedAt: now, lastUsedStep: step })
      .where(eq(totpCredentials.id, row.id));
    return succeed({
      userId: row.userId,
      recoveryCodes: await recoveryCodesForNewFactor(scope, now),
      completesEnrolment: await finishEnrolment(scope, now),
      remember: scope.actor.remember,
    });
  });
}

export function removeTotp(ref: ActorRef, now: Date): Promise<Outcome<{ ok: true }>> {
  return withFactorScope(ref, now, { reauthenticate: true }, async (scope) => {
    if (!scope.before.totp) return refuse("totp_not_enabled");
    const after = { ...scope.before, totp: false };
    const refusal = checkRemoval(scope, after);
    if (refusal) return refusal;
    await scope.tx.delete(totpCredentials).where(eq(totpCredentials.userId, scope.actor.userId));
    await afterFactorRemoved(scope, after);
    return succeed({ ok: true } as const);
  });
}
