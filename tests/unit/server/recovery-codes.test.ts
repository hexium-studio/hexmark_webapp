import { createHmac, hkdfSync } from "node:crypto";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  recoveryCodeSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { createKeyring } from "../../../apps/server/src/lib/crypto";
import {
  activeRecoveryDigest,
  candidateRecoveryDigests,
  generateRecoveryCodes,
  recoveryCodeDigest,
  recoveryDigestKey,
} from "../../../apps/server/src/services/two-factor/recovery-codes";

// Recovery codes: alphabet, format, normalisation of typed codes and the
// keyed digest that is stored instead of them.

describe("format", () => {
  it("uses an alphabet without look-alikes", () => {
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    for (const char of "01OI") expect(RECOVERY_CODE_ALPHABET).not.toContain(char);
  });

  it("generates a set of distinct codes of 12 alphabet characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJ-NP-Z]{12}$/);
    expect(formatRecoveryCode("ABCDEFGHJKLM")).toBe("ABCD-EFGH-JKLM");
  });

  it("uses every character of the alphabet over many codes", () => {
    const seen = new Set(generateRecoveryCodes(200).join(""));
    expect(seen.size).toBe(32);
  });
});

describe("normalisation", () => {
  it.each([
    ["ABCD-EFGH-JKLM", "ABCDEFGHJKLM"],
    ["abcd-efgh-jklm", "ABCDEFGHJKLM"],
    [" abcd efgh jklm ", "ABCDEFGHJKLM"],
    ["ABCDEFGHJKLM", "ABCDEFGHJKLM"],
    ["AB-CD-EF-GH-JK-LM", "ABCDEFGHJKLM"],
  ])("reads %j", (typed, normalized) => {
    expect(normalizeRecoveryCode(typed)).toBe(normalized);
    expect(recoveryCodeSchema.parse(typed)).toBe(normalized);
  });

  it.each([
    ["ABCD-EFGH-JKL"],
    ["ABCD-EFGH-JKLMN"],
    ["ABCD-EFGH-JKL0"],
    ["ABCD-EFGH-JKLI"],
    ["ABCD_EFGH_JKLM"],
  ])("refuses %j", (typed) => {
    expect(normalizeRecoveryCode(typed)).toBeNull();
    expect(recoveryCodeSchema.safeParse(typed).error?.issues[0]?.message).toBe("invalid_format");
  });

  it("reports an empty code as required", () => {
    expect(recoveryCodeSchema.safeParse("  ").error?.issues[0]?.message).toBe("required");
  });
});

describe("digest", () => {
  const current = Buffer.alloc(32, 7);
  const previous = Buffer.alloc(32, 9);

  it("is HMAC-SHA256 under an HKDF-derived key, as lower-case hex", () => {
    const key = Buffer.from(
      hkdfSync("sha256", current, Buffer.alloc(0), "hexmark/recovery-codes/hmac-sha256/v1", 32),
    );
    expect(recoveryDigestKey(current)).toEqual(key);
    expect(key.equals(current)).toBe(false);
    const expected = createHmac("sha256", key).update("ABCDEFGHJKLM").digest("hex");
    expect(recoveryCodeDigest("ABCDEFGHJKLM", key)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on the key and the code", () => {
    const a = recoveryCodeDigest("ABCDEFGHJKLM", recoveryDigestKey(current));
    expect(recoveryCodeDigest("ABCDEFGHJKLN", recoveryDigestKey(current))).not.toBe(a);
    expect(recoveryCodeDigest("ABCDEFGHJKLM", recoveryDigestKey(previous))).not.toBe(a);
  });

  it("stores under the active key and matches under every key of the ring", () => {
    const keyring = createKeyring("new", [
      ["new", current],
      ["old", previous],
    ]);
    const stored = activeRecoveryDigest("ABCDEFGHJKLM", keyring);
    expect(stored).toBe(recoveryCodeDigest("ABCDEFGHJKLM", recoveryDigestKey(current)));
    const oldDigest = recoveryCodeDigest("ABCDEFGHJKLM", recoveryDigestKey(previous));
    expect(candidateRecoveryDigests("ABCDEFGHJKLM", keyring).sort()).toEqual(
      [stored, oldDigest].sort(),
    );
  });
});
