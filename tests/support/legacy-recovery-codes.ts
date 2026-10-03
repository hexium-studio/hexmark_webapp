import { formatRecoveryCode } from "@hexmark/shared";
import { createKeyring } from "../../apps/server/src/lib/crypto";
import {
  activeRecoveryDigest,
  generateRecoveryCodes,
} from "../../apps/server/src/services/two-factor/recovery-codes";
import type { TestDatabase } from "./databases";
import { TEST_ENCRYPTION_KEY } from "./hexmark-server";

// A set of recovery codes as an earlier version issued it, possibly larger
// than a fresh set today: replaces the user's codes in the database (digests
// under the test servers' ENCRYPTION_KEY) and returns them formatted.
export async function seedLegacyRecoveryCodes(
  db: TestDatabase,
  userId: string,
  count: number,
): Promise<string[]> {
  const keyring = createKeyring("test", [["test", Buffer.from(TEST_ENCRYPTION_KEY, "base64url")]]);
  const codes = generateRecoveryCodes(count);
  await db.sql`delete from recovery_codes where user_id = ${userId}`;
  for (const code of codes) {
    await db.sql`insert into recovery_codes (user_id, code_hash, created_at)
      values (${userId}, ${activeRecoveryDigest(code, keyring)}, now() - interval '1 year')`;
  }
  return codes.map(formatRecoveryCode);
}
