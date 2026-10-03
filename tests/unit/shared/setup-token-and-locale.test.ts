import {
  isLocale,
  LOCALE_PATTERN,
  type Locale,
  localeSchema,
  parentLocale,
  SETUP_TOKEN_FORMAT_HINT,
  SETUP_TOKEN_LENGTH,
  SETUP_TOKEN_PATTERN,
  setupTokenSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

describe("setup token", () => {
  it("is 8 characters, A-Z and 0-9", () => {
    expect(SETUP_TOKEN_LENGTH).toBe(8);
    expect(SETUP_TOKEN_PATTERN.source).toBe("^[A-Z0-9]{8}$");
    expect(SETUP_TOKEN_FORMAT_HINT).toBe("exactly 8 characters, A-Z and 0-9");
  });

  it.each([
    ["ABCD1234", "ABCD1234"],
    ["abcd1234", "ABCD1234"],
    ["  abCD1234\t", "ABCD1234"],
    ["\nZZZZ9999 ", "ZZZZ9999"],
  ])("normalises %j to %j", (raw, normalised) => {
    expect(setupTokenSchema.parse(raw)).toBe(normalised);
  });

  it.each(["ABCD123", "ABCD12345", "ABCD 1234", "ABCD-123", "ÄBCD1234", "", "        "])(
    "refuses %j with invalid_format and the length",
    (raw) => {
      const parsed = setupTokenSchema.safeParse(raw);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({
        message: "invalid_format",
        params: { length: 8 },
      });
    },
  );
});

describe("locale codes", () => {
  it.each(["en", "de", "fil", "pt-BR", "de-CH", "zh-TW"])("%s is a locale", (code) => {
    expect(LOCALE_PATTERN.test(code)).toBe(true);
    expect(isLocale(code)).toBe(true);
  });

  it.each([
    "",
    "e",
    "EN",
    "De",
    "english",
    "pt-br",
    "pt_BR",
    "de-CHE",
    "de-",
    "-CH",
    "en-US-x",
    42,
    null,
  ])("%j is not a locale", (code) => {
    expect(isLocale(code)).toBe(false);
  });

  it("refuses a malformed code with invalid_option and a missing one with required", () => {
    expect(localeSchema.safeParse("EN").error?.issues[0]?.message).toBe("invalid_option");
    expect(localeSchema.safeParse(undefined).error?.issues[0]?.message).toBe("required");
  });

  it("finds the language of a regional code", () => {
    expect(parentLocale("de-CH" as Locale)).toBe("de");
    expect(parentLocale("pt-BR" as Locale)).toBe("pt");
    expect(parentLocale("de" as Locale)).toBeUndefined();
  });
});
