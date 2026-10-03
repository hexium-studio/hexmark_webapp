import { fieldErrorsFromZod, loginInputSchema, USER_ROLES } from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// The sign-in input as both the web form and the API check it.

function fields(input: unknown) {
  const result = loginInputSchema.safeParse(input);
  return result.success ? null : fieldErrorsFromZod(result.error);
}

describe("loginInputSchema", () => {
  it("normalises the e-mail and keeps the password as typed", () => {
    expect(
      loginInputSchema.parse({ email: "  Ada@Example.COM ", password: " pw ", remember: true }),
    ).toEqual({ email: "ada@example.com", password: " pw ", remember: true });
  });

  it("does not apply the password length rules of account creation", () => {
    expect(fields({ email: "a@example.com", password: "x", remember: false })).toBeNull();
  });

  it.each([
    [
      "nothing",
      {},
      {
        email: { code: "required" },
        password: { code: "required" },
        remember: { code: "required" },
      },
    ],
    [
      "blank e-mail",
      { email: "  ", password: "x", remember: false },
      { email: { code: "required" } },
    ],
    [
      "no @",
      { email: "ada", password: "x", remember: false },
      { email: { code: "invalid_email" } },
    ],
    [
      "empty password",
      { email: "a@example.com", password: "", remember: false },
      { password: { code: "required" } },
    ],
    [
      "a number as password",
      { email: "a@example.com", password: 1, remember: false },
      { password: { code: "invalid_type" } },
    ],
    [
      "remember as text",
      { email: "a@example.com", password: "x", remember: "yes" },
      { remember: { code: "invalid_type" } },
    ],
    [
      "remember null",
      { email: "a@example.com", password: "x", remember: null },
      { remember: { code: "required" } },
    ],
  ])("reports field codes for %s", (_, input, expected) => {
    expect(fields(input)).toEqual(expected);
  });

  it("lists the role presets", () => {
    expect(USER_ROLES).toEqual(["admin", "user", "guest"]);
  });
});
