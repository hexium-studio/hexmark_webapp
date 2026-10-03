import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";

// Recovery codes: the fallback when no second factor is at hand. Each code is
// 12 characters from an alphabet without look-alikes (no 0/O, no 1/I), shown
// as three groups of four: "ABCD-EFGH-JKLM". 32 characters give 5 bits each,
// 60 bits per code.

export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const RECOVERY_CODE_GROUPS = 3;
export const RECOVERY_CODE_GROUP_LENGTH = 4;
export const RECOVERY_CODE_LENGTH = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;
// Codes issued at once; each one works a single time. Sets issued earlier
// may hold more codes, which stay valid until they are used or replaced, so
// nothing may assume an account has at most this many.
export const RECOVERY_CODE_COUNT = 3;

// Whether so few unused codes are left that the user should generate new
// ones: fewer than a fresh set holds.
export function fewRecoveryCodesLeft(remaining: number): boolean {
  return remaining < RECOVERY_CODE_COUNT;
}

const NORMALIZED = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);

// The code as stored and compared: upper case, without spaces and hyphens.
// Null when what remains is not 12 characters of the alphabet.
export function normalizeRecoveryCode(raw: string): string | null {
  const compact = raw.replace(/[\s-]+/g, "").toUpperCase();
  return NORMALIZED.test(compact) ? compact : null;
}

// "ABCDEFGHJKLM" -> "ABCD-EFGH-JKLM"; expects a normalized code.
export function formatRecoveryCode(normalized: string): string {
  const groups: string[] = [];
  for (let start = 0; start < normalized.length; start += RECOVERY_CODE_GROUP_LENGTH) {
    groups.push(normalized.slice(start, start + RECOVERY_CODE_GROUP_LENGTH));
  }
  return groups.join("-");
}

const invalidFormat: FieldErrorCode = "invalid_format";

// Input field of a recovery code; yields the normalized form.
export const recoveryCodeSchema = z
  .string({ error: requiredOr("invalid_type") })
  .transform((value, context) => {
    const normalized = normalizeRecoveryCode(value);
    if (normalized === null) {
      context.addIssue({
        code: "custom",
        message: value.trim() === "" ? "required" : invalidFormat,
        params: { length: RECOVERY_CODE_LENGTH },
      });
      return z.NEVER;
    }
    return normalized;
  });
