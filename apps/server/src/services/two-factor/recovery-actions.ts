import { type Outcome, succeed } from "../../lib/outcome";
import type { ActorRef } from "./actor";
import { hasAnyFactor } from "./factor-state";
import { withFactorScope } from "./factor-transaction";
import { issueRecoveryCodes } from "./recovery-store";
import { refuse } from "./refusals";

// A new set of recovery codes; the old ones stop working at once. Needs a
// recent password re-entry and at least one second factor (codes stand in
// for a factor, they are not one).
export function regenerateRecoveryCodes(
  ref: ActorRef,
  now: Date,
): Promise<Outcome<{ recoveryCodes: string[] }>> {
  const options = {
    reauthenticate: true,
    action: "two_factor.recovery_codes_regenerated",
  } as const;
  return withFactorScope(ref, now, options, async (scope) => {
    if (!hasAnyFactor(scope.before)) return refuse("second_factor_missing");
    const recoveryCodes = await issueRecoveryCodes(scope.tx, scope.actor.userId, now);
    await scope.record({ details: { recoveryCodeCount: recoveryCodes.length } });
    return succeed({ recoveryCodes });
  });
}
