import {
  factorCounts,
  fewRecoveryCodesLeft,
  hasAnyFactor,
  mayRemoveFactor,
  RECOVERY_CODE_COUNT,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// The factor rules the server enforces and the account page offers
// (packages/shared/src/two-factor.ts).

describe("factor rules", () => {
  it("counts an app and keys as factors", () => {
    expect(hasAnyFactor({ totp: false, webauthn: 0 })).toBe(false);
    expect(hasAnyFactor({ totp: true, webauthn: 0 })).toBe(true);
    expect(hasAnyFactor({ totp: false, webauthn: 2 })).toBe(true);
  });

  it("keeps the last factor only while the instance requires one", () => {
    const none = { totp: false, webauthn: 0 };
    expect(mayRemoveFactor(true, none)).toBe(false);
    expect(mayRemoveFactor(false, none)).toBe(true);
    expect(mayRemoveFactor(true, { totp: false, webauthn: 1 })).toBe(true);
  });

  it("reads the counts of an overview", () => {
    const overview = {
      totp: { enabled: true },
      webauthn: { available: false, credentials: [] },
      recoveryCodes: { remaining: 10 },
      requireTwoFactor: true,
    };
    expect(factorCounts(overview)).toEqual({ totp: true, webauthn: 0 });
  });

  it("asks for new recovery codes once fewer than a fresh set are left", () => {
    expect(RECOVERY_CODE_COUNT).toBe(3);
    expect(fewRecoveryCodesLeft(10)).toBe(false);
    expect(fewRecoveryCodesLeft(3)).toBe(false);
    expect(fewRecoveryCodesLeft(2)).toBe(true);
    expect(fewRecoveryCodesLeft(0)).toBe(true);
  });
});
