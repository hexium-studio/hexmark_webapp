import type { SystemSettingsInput } from "@hexmark/shared";
import { instanceSettings } from "../../../db/schema";
import { type Outcome, succeed } from "../../../lib/outcome";
import type { ActorRef } from "../../../services/two-factor/actor";
import { consumeChallenge } from "../../../services/two-factor/challenges";
import { hasAnyFactor } from "../../../services/two-factor/factor-state";
import { withFactorScope } from "../../../services/two-factor/factor-transaction";
import { refuse } from "../../../services/two-factor/refusals";

// Wizard step 6: the instance's default time zone and whether every account
// needs a second factor. Requiring one is allowed only when the admin who
// sets it has one, checked under the same locks that removing a factor
// takes (settings row for update, then the admin's row), so the admin cannot
// lock themselves out. Saving ends the wizard: the ticket is used up.
export function saveSystemSettings(
  ref: ActorRef,
  input: SystemSettingsInput,
  now: Date,
): Promise<Outcome<{ ok: true }>> {
  return withFactorScope(ref, now, { settings: "update" }, async (scope) => {
    if (input.requireTwoFactor && !hasAnyFactor(scope.before)) {
      return refuse("second_factor_missing");
    }
    const values = {
      defaultTimezone: input.timezone,
      requireTwoFactor: input.requireTwoFactor,
      updatedAt: now,
    };
    await scope.tx
      .insert(instanceSettings)
      .values({ id: 1, ...values, createdAt: now })
      .onConflictDoUpdate({ target: instanceSettings.id, set: values });
    if (scope.actor.challengeId) await consumeChallenge(scope.tx, scope.actor.challengeId, now);
    return succeed({ ok: true } as const);
  });
}
