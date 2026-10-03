import {
  canonicalTimezone,
  fieldErrorsFromZod,
  systemSettingsInputSchema,
  timezoneSchema,
  totpCodeSchema,
  webauthnNameSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// Input rules shared by server and web: time zones, authenticator codes,
// security key names and the system settings of setup step 6.

describe("time zones", () => {
  it.each([
    ["Europe/Berlin", "Europe/Berlin"],
    ["europe/berlin", "Europe/Berlin"],
    ["UTC", "UTC"],
    ["utc", "UTC"],
    ["America/New_York", "America/New_York"],
    // Aliases resolve as the runtime's Intl spells them.
    ["US/Pacific", "America/Los_Angeles"],
    ["Etc/GMT+5", "Etc/GMT+5"],
  ])("accepts %j as %j", (input, canonical) => {
    expect(canonicalTimezone(input)).toBe(canonical);
    expect(timezoneSchema.parse(` ${input} `)).toBe(canonical);
  });

  it.each([["Mars/Olympus"], ["+01:00"], ["Europe/ Berlin"], [""], ["A".repeat(65)], ["../etc"]])(
    "refuses %j",
    (input) => {
      expect(canonicalTimezone(input)).toBeNull();
      const result = timezoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    },
  );

  it("reports invalid_option, and required for a missing value", () => {
    const missing = systemSettingsInputSchema.safeParse({ requireTwoFactor: false });
    expect(missing.error && fieldErrorsFromZod(missing.error)).toEqual({
      timezone: { code: "required" },
    });
    const wrong = systemSettingsInputSchema.safeParse({ timezone: "Nowhere", requireTwoFactor: 1 });
    expect(wrong.error && fieldErrorsFromZod(wrong.error)).toEqual({
      timezone: { code: "invalid_option" },
      requireTwoFactor: { code: "invalid_type" },
    });
  });
});

describe("authenticator codes", () => {
  it("accepts six digits, ignoring spaces", () => {
    expect(totpCodeSchema.parse("123456")).toBe("123456");
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it.each([
    ["12345", "invalid_format"],
    ["1234567", "invalid_format"],
    ["12a456", "invalid_format"],
    ["", "required"],
  ])("refuses %j with %s", (input, code) => {
    expect(totpCodeSchema.safeParse(input).error?.issues[0]?.message).toBe(code);
  });
});

describe("security key names", () => {
  it("trims and allows 1 to 64 characters", () => {
    expect(webauthnNameSchema.parse("  Desk key ")).toBe("Desk key");
    expect(webauthnNameSchema.parse("x".repeat(64))).toHaveLength(64);
    expect(webauthnNameSchema.safeParse("   ").error?.issues[0]?.message).toBe("required");
    expect(webauthnNameSchema.safeParse("x".repeat(65)).error?.issues[0]?.message).toBe("too_long");
  });
});
