import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_COUNT, RECOVERY_CODE_LENGTH } from "@hexmark/shared";
import { RECOVERY_CODE_HMAC_INFO } from "../../config/two-factor";
import type { Keyring } from "../../lib/crypto";

// Recovery codes: generating them and the digest that is stored instead of
// the code. Pure apart from the random source; the database side is in
// recovery-store.ts.
//
// The digest is HMAC-SHA256 with a key derived from ENCRYPTION_KEY (HKDF
// with a fixed info string). Codes carry 60 random bits, so a fast keyed
// digest suffices: without the key a leaked table cannot be tested against
// guesses at all. Each key in the keyring yields its own digest key, so codes
// stored before ENCRYPTION_KEY was replaced still match while the old key is
// kept as ENCRYPTION_KEY_PREVIOUS.

// One code, normalized (12 characters, no separators). The alphabet has 32
// characters, so each random byte maps to one character without bias.
export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
  return code;
}

// A fresh set of distinct codes.
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

export function recoveryDigestKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", encryptionKey, Buffer.alloc(0), RECOVERY_CODE_HMAC_INFO, 32),
  );
}

// The stored form of a normalized code: lower-case hex, 64 characters.
export function recoveryCodeDigest(normalized: string, digestKey: Buffer): string {
  return createHmac("sha256", digestKey).update(normalized, "utf8").digest("hex");
}

// The digest under the active key (for storing new codes).
export function activeRecoveryDigest(normalized: string, keyring: Keyring): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error("the active key is not in the keyring");
  return recoveryCodeDigest(normalized, recoveryDigestKey(key));
}

// The digests under every key in the keyring (for matching a typed code).
export function candidateRecoveryDigests(normalized: string, keyring: Keyring): string[] {
  return [...keyring.keys.values()].map((key) =>
    recoveryCodeDigest(normalized, recoveryDigestKey(key)),
  );
}
