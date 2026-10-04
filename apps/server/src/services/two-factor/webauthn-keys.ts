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
  const options = { action: "two_factor.security_key_renamed" } as const;
  return withFactorScope(ref, now, options, async (scope) => {
    const [before] = await scope.tx
      .select({ name: webauthnCredentials.name })
      .from(webauthnCredentials)
      .where(ownKey(scope, id))
      .for("update");
    if (!before) return refuse("credential_not_found");
    const [row] = await scope.tx
      .update(webauthnCredentials)
      .set({ name })
      .where(ownKey(scope, id))
      .returning();
    if (!row) return refuse("credential_not_found");
    await scope.record({
      target: { kind: "security_key", id: row.id, label: row.name },
      details: { previousName: before.name, name: row.name },
    });
    return succeed(credentialSummary(row));
  });
}

export function removeKey(ref: ActorRef, id: string, now: Date): Promise<Outcome<{ ok: true }>> {
  if (!UUID_PATTERN.test(id)) return Promise.resolve(refuse("credential_not_found"));
  const options = { reauthenticate: true, action: "two_factor.security_key_removed" } as const;
  return withFactorScope(ref, now, options, async (scope) => {
    const [row] = await scope.tx
      .select({ id: webauthnCredentials.id, name: webauthnCredentials.name })
      .from(webauthnCredentials)
      .where(ownKey(scope, id));
    if (!row) return refuse("credential_not_found");
    const after = { ...scope.before, webauthn: scope.before.webauthn - 1 };
    const refusal = checkRemoval(scope, after);
    if (refusal) return refusal;
    await scope.tx.delete(webauthnCredentials).where(ownKey(scope, id));
    await afterFactorRemoved(scope, after);
    await scope.record({ target: { kind: "security_key", id: row.id, label: row.name } });
    return succeed({ ok: true } as const);
  });
}
