import {
  FIELD_ERROR_CODES,
  fieldErrorsFromZod,
  isFieldErrorCode,
  setupInputSchema,
  setupStatusSchema,
  verifyTokenInputSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// The setup input schema shared by server and wizard, and the field error
// codes (+ params) it reports.

const valid = {
  displayName: "Ada Admin",
  username: "ada",
  email: "ada@example.com",
  password: "correct horse battery",
  passwordConfirm: "correct horse battery",
  setupToken: "TEST2345",
  locale: "en",
};

function errorsOf(input: Record<string, unknown>) {
  const parsed = setupInputSchema.safeParse(input);
  if (parsed.success) return {};
  return fieldErrorsFromZod(parsed.error);
}

describe("setupInputSchema", () => {
  it("accepts and normalises a valid input", () => {
    const parsed = setupInputSchema.parse({
      ...valid,
      displayName: "  Ada  ",
      username: " Ada_Admin-1 ",
      email: " Ada@Example.COM ",
      setupToken: " test2345 ",
    });
    expect(parsed).toMatchObject({
      displayName: "Ada",
      username: "ada_admin-1",
      email: "ada@example.com",
      setupToken: "TEST2345",
    });
  });

  it.each([
    // field, value, expected error
    ["displayName", undefined, { code: "required" }],
    ["displayName", "   ", { code: "required" }],
    ["displayName", 7, { code: "invalid_type" }],
    ["displayName", "x".repeat(64), undefined],
    ["displayName", "x".repeat(65), { code: "too_long", params: { max: 64 } }],
    ["username", "ab", { code: "too_short", params: { min: 3 } }],
    ["username", "abc", undefined],
    ["username", "a".repeat(32), undefined],
    ["username", "a".repeat(33), { code: "too_long", params: { max: 32 } }],
    ["username", "_ada", { code: "invalid_format" }],
    ["username", "ada smith", { code: "invalid_format" }],
    ["username", "adä", { code: "invalid_format" }],
    ["email", "", { code: "required" }],
    ["email", "ada@", { code: "invalid_email" }],
    ["email", `${"a".repeat(250)}@x.de`, { code: "too_long", params: { max: 254 } }],
    ["password", "x".repeat(11), { code: "too_short", params: { min: 12 } }],
    ["password", "x".repeat(129), { code: "too_long", params: { max: 128 } }],
    ["password", null, { code: "required" }],
    ["locale", "fr", undefined],
    ["locale", "pt-BR", undefined],
    ["locale", "pt-br", { code: "invalid_option" }],
    ["locale", 1, { code: "invalid_option" }],
    ["locale", undefined, { code: "required" }],
    ["setupToken", "ABC", { code: "invalid_format", params: { length: 8 } }],
    ["setupToken", undefined, { code: "required" }],
    ["setupToken", 12345678, { code: "invalid_type" }],
  ])("%s = %j gives %j", (field, value, expected) => {
    const input: Record<string, unknown> = { ...valid, [field]: value };
    if (field === "password") input.passwordConfirm = value;
    const errors = errorsOf(input) as Record<string, unknown>;
    expect(errors[field]).toEqual(expected);
  });

  it("reports a mismatching confirmation on passwordConfirm", () => {
    expect(errorsOf({ ...valid, passwordConfirm: "something else" })).toEqual({
      passwordConfirm: { code: "mismatch" },
    });
  });

  it("reports an empty confirmation as required, not as a mismatch", () => {
    expect(errorsOf({ ...valid, passwordConfirm: "" })).toEqual({
      passwordConfirm: { code: "required" },
    });
  });

  it("does not trim passwords", () => {
    const password = "  twelve chars  ";
    expect(setupInputSchema.parse({ ...valid, password, passwordConfirm: password }).password).toBe(
      password,
    );
  });
});

describe("fieldErrorsFromZod", () => {
  it("keeps the first problem per field and uses 'body' for the input as a whole", () => {
    const parsed = verifyTokenInputSchema.safeParse("not an object");
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(fieldErrorsFromZod(parsed.error)).toEqual({ body: { code: "invalid" } });
  });

  it("only produces known codes", () => {
    const errors = errorsOf({});
    for (const error of Object.values(errors)) expect(isFieldErrorCode(error.code)).toBe(true);
  });
});

describe("field error codes", () => {
  it("are the documented list", () => {
    expect(FIELD_ERROR_CODES).toEqual([
      "required",
      "empty",
      "invalid_type",
      "too_short",
      "too_long",
      "invalid_format",
      "invalid_email",
      "invalid_option",
      "mismatch",
      "taken",
      "invalid_body",
      "invalid",
    ]);
    expect(isFieldErrorCode("taken")).toBe(true);
    expect(isFieldErrorCode("nope")).toBe(false);
    expect(isFieldErrorCode(1)).toBe(false);
  });
});

describe("setupStatusSchema", () => {
  it("accepts the status body and refuses an incomplete one", () => {
    const status = {
      setupOpen: true,
      setupTokenPresent: true,
      setupTokenConfigured: false,
      secretsConfigured: true,
      database: { reachable: true, migrated: false },
    };
    expect(setupStatusSchema.parse(status)).toEqual(status);
    const { secretsConfigured: _, ...withoutSecrets } = status;
    expect(setupStatusSchema.safeParse(withoutSecrets).success).toBe(false);
    expect(setupStatusSchema.safeParse({ setupOpen: true }).success).toBe(false);
  });
});
