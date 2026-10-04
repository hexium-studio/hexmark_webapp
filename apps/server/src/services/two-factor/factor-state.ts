import { type FactorCounts, hasAnyFactor } from "@hexmark/shared";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import {
  instanceSettings,
  recoveryCodes,
  totpCredentials,
  users,
  webauthnCredentials,
} from "../../db/schema";

// Which second factors an account has, and the locks under which that is
// decided. Rules that depend on it ("the last factor stays while the instance
// requires one", "requiring factors needs one yourself", "no session without
// the second factor") read it while holding these locks, always in the same
// order: the instance settings row first, then the user's row. Changing a
// factor holds the user's row for update, so a check and the change it
// depends on cannot interleave, and the fixed order rules out deadlocks.

// The counting rules are shared with the web app (@hexmark/shared), so the
// account page offers exactly what is allowed here.
export { type FactorCounts, hasAnyFactor } from "@hexmark/shared";

export async function countFactors(tx: Transaction, userId: string): Promise<FactorCounts> {
  const [totp] = await tx
    .select({ n: count() })
    .from(totpCredentials)
    .where(and(eq(totpCredentials.userId, userId), isNotNull(totpCredentials.confirmedAt)));
  const [keys] = await tx
    .select({ n: count() })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return { totp: (totp?.n ?? 0) > 0, webauthn: keys?.n ?? 0 };
}

export async function countUnusedRecoveryCodes(tx: Transaction, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return row?.n ?? 0;
}

// Locks the instance settings row ("share" to read the requirement, "update"
// to change it) and then the user's row ("update" to change factors, "share"
// to rely on them). Returns whether the instance requires a second factor
// (before setup wrote the row, it does not) and the username (for the audit
// log). Null when the user is gone.
export async function lockFactorOwner(
  tx: Transaction,
  userId: string,
  modes: { settings: "share" | "update"; user: "share" | "update" },
): Promise<{ requireTwoFactor: boolean; username: string } | null> {
  const [settings] = await tx
    .select({ requireTwoFactor: instanceSettings.requireTwoFactor })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
    .for(modes.settings);
  const [user] = await tx
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .for(modes.user);
  if (!user) return null;
  return { requireTwoFactor: settings?.requireTwoFactor ?? false, username: user.username };
}

export type SignInRequirement = "none" | "second_factor" | "enrolment";

// What a correct password still needs before a session may start: the
// second factor when the account has one; enrolment when the instance
// requires a factor and the account has none. Call under lockFactorOwner.
export function signInRequirement(
  requireTwoFactor: boolean,
  counts: FactorCounts,
): SignInRequirement {
  if (hasAnyFactor(counts)) return "second_factor";
  return requireTwoFactor ? "enrolment" : "none";
}
