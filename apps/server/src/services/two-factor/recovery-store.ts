import { formatRecoveryCode } from "@hexmark/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { recoveryCodes } from "../../db/schema";
import { encryptionKeyring } from "./keyring";
import {
  activeRecoveryDigest,
  candidateRecoveryDigests,
  generateRecoveryCodes,
} from "./recovery-codes";

// Recovery codes in the database: only their digests are stored
// (recovery-codes.ts); the codes themselves exist once, in the response
// that hands them to the user.

// Replaces all of the user's codes with a fresh set and returns it,
// formatted for display ("ABCD-EFGH-JKLM").
export async function issueRecoveryCodes(
  tx: Transaction,
  userId: string,
  now: Date,
): Promise<string[]> {
  const keyring = encryptionKeyring();
  const codes = generateRecoveryCodes();
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await tx.insert(recoveryCodes).values(
    codes.map((code) => ({
      userId,
      codeHash: activeRecoveryDigest(code, keyring),
      createdAt: now,
    })),
  );
  return codes.map(formatRecoveryCode);
}

export async function deleteRecoveryCodes(tx: Transaction, userId: string): Promise<void> {
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
}

// Uses up the code if it is one of the user's unused codes. The condition
// "unused" is part of the update, so a code cannot be redeemed twice, also
// not by two requests at once. `normalized`: see normalizeRecoveryCode.
export async function redeemRecoveryCode(
  tx: Transaction,
  userId: string,
  normalized: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(recoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        inArray(recoveryCodes.codeHash, candidateRecoveryDigests(normalized, encryptionKeyring())),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return rows.length > 0;
}
