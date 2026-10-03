import type { TwoFactorOverview } from "@hexmark/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { webauthnConfig } from "../../config/webauthn";
import { getDb } from "../../db/client";
import { instanceSettings, totpCredentials } from "../../db/schema";
import { type Outcome, succeed } from "../../lib/outcome";
import { type ActorRef, isFailure, type LockedActor, lockActor } from "./actor";
import { countUnusedRecoveryCodes } from "./factor-state";
import { credentialSummary, userKeys } from "./webauthn-common";

// What the account security page (and setup step 5) shows: the account's
// factors, how many recovery codes are left, and whether the instance
// requires a second factor. Read under the actor's lock, so a revoked
// session or used-up ticket gets no answer.
export function readOverview(
  ref: ActorRef,
  now: Date,
): Promise<Outcome<{ overview: TwoFactorOverview; actor: LockedActor }>> {
  return getDb().transaction(async (tx) => {
    const actor = await lockActor(tx, ref, now);
    if (isFailure(actor)) return actor;
    const { userId } = actor;
    const [totp] = await tx
      .select({ id: totpCredentials.id })
      .from(totpCredentials)
      .where(and(eq(totpCredentials.userId, userId), isNotNull(totpCredentials.confirmedAt)));
    const [settings] = await tx
      .select({ requireTwoFactor: instanceSettings.requireTwoFactor })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    const keys = await userKeys(tx, userId);
    const overview: TwoFactorOverview = {
      totp: { enabled: totp !== undefined },
      webauthn: { available: webauthnConfig().enabled, credentials: keys.map(credentialSummary) },
      recoveryCodes: { remaining: await countUnusedRecoveryCodes(tx, userId) },
      requireTwoFactor: settings?.requireTwoFactor ?? false,
    };
    return succeed({ overview, actor });
  });
}
