import type { WebauthnCredentialSummary } from "@hexmark/shared";
import { and, eq } from "drizzle-orm";
import { webauthnCredentials } from "../../db/schema";
import { type Outcome, succeed } from "../../lib/outcome";
import type { ActorRef } from "./actor";
import {
  afterFactorRemoved,
  checkRemoval,
  type FactorScope,
  withFactorScope,
} from "./factor-transaction";
import { refuse } from "./refusals";
import { credentialSummary, UUID_PATTERN } from "./webauthn-common";

// Renaming and removing registered security keys. Both work without
// PUBLIC_ORIGIN as well, so keys can be cleaned up after it was removed.

function ownKey(scope: FactorScope, id: string) {
  return and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, scope.actor.userId));
}

export function renameKey(
  ref: ActorRef,
  id: string,
  name: string,
  now: Date,
): Promise<Outcome<WebauthnCredentialSummary>> {
  if (!UUID_PATTERN.test(id)) return Promise.resolve(refuse("credential_not_found"));
  return withFactorScope(ref, now, {}, async (scope) => {
    const [row] = await scope.tx
      .update(webauthnCredentials)
      .set({ name })
      .where(ownKey(scope, id))
      .returning();
    return row ? succeed(credentialSummary(row)) : refuse("credential_not_found");
  });
}

export function removeKey(ref: ActorRef, id: string, now: Date): Promise<Outcome<{ ok: true }>> {
  if (!UUID_PATTERN.test(id)) return Promise.resolve(refuse("credential_not_found"));
  return withFactorScope(ref, now, { reauthenticate: true }, async (scope) => {
    const [row] = await scope.tx
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(ownKey(scope, id));
    if (!row) return refuse("credential_not_found");
    const after = { ...scope.before, webauthn: scope.before.webauthn - 1 };
    const refusal = checkRemoval(scope, after);
    if (refusal) return refusal;
    await scope.tx.delete(webauthnCredentials).where(ownKey(scope, id));
    await afterFactorRemoved(scope, after);
    return succeed({ ok: true } as const);
  });
}
