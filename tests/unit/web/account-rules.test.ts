import { ACCOUNT_LIMITS } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { type AccountFieldName, validateAccount } from "@/app/setup/_components/account-form";
import { ACCOUNT_RULES, accountRuleStates } from "@/app/setup/_components/account-rules";

// The rule checklists of the setup account step: each rule is met exactly
// when the shared schema has nothing to object to on that point.

const valid: Record<AccountFieldName, string> = {
  displayName: "Ada",
  username: "ada",
  email: "ada@example.com",
  password: "correct horse battery",
  passwordConfirm: "correct horse battery",
};

function statesFor(values: Record<AccountFieldName, string>) {
  const result = validateAccount(values, "TEST2345", "en");
  return accountRuleStates(values, result.ok ? {} : result.errors);
}

describe("accountRuleStates", () => {
  it("meets every rule for values the schema accepts", () => {
    expect(Object.values(statesFor(valid)).every(Boolean)).toBe(true);
  });

  it("meets no rule for the empty form", () => {
    const empty = { displayName: "", username: "", email: "", password: "", passwordConfirm: "" };
    expect(Object.values(statesFor(empty)).some(Boolean)).toBe(false);
  });

  it("tells the username's length from its characters", () => {
    expect(statesFor({ ...valid, username: "ab" })).toMatchObject({
      usernameLength: false,
      usernameChars: true,
    });
    expect(statesFor({ ...valid, username: "_ada" })).toMatchObject({
      usernameLength: true,
      usernameChars: false,
    });
    // Upper case is stored in lower case, so it counts as allowed.
    expect(statesFor({ ...valid, username: "Ada" })).toMatchObject({ usernameChars: true });
    expect(statesFor({ ...valid, username: "a".repeat(33) })).toMatchObject({
      usernameLength: false,
    });
  });

  it("follows the length limits of the shared schema", () => {
    const { min, max } = ACCOUNT_LIMITS.password;
    const at = (length: number) => {
      const password = "p".repeat(length);
      return statesFor({ ...valid, password, passwordConfirm: password }).passwordLength;
    };
    expect([at(min - 1), at(min), at(max), at(max + 1)]).toEqual([false, true, true, false]);
    expect(statesFor({ ...valid, displayName: " " }).displayNameLength).toBe(false);
    expect(statesFor({ ...valid, displayName: "d".repeat(65) }).displayNameLength).toBe(false);
  });

  it("checks e-mail and confirmation", () => {
    expect(statesFor({ ...valid, email: "ada@" }).emailValid).toBe(false);
    expect(statesFor({ ...valid, passwordConfirm: "correct horse batterz" }).passwordMatch).toBe(
      false,
    );
  });

  it("gives every field at least one rule, with the limits as placeholders", () => {
    for (const rules of Object.values(ACCOUNT_RULES)) expect(rules.length).toBeGreaterThan(0);
    expect(ACCOUNT_RULES.username[0]?.params).toEqual({ min: 3, max: 32 });
    expect(ACCOUNT_RULES.password[0]?.params).toEqual({ min: 12, max: 128 });
  });
});
