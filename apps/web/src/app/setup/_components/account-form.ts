import {
  type FieldError,
  type FieldErrors,
  fieldErrorsFromZod,
  type SetupInput,
  setupInputSchema,
} from "@hexmark/shared";

// Fields of the account step and their client-side validation with the
// shared schema, so the browser rejects exactly what the server would reject.
// Errors stay codes (+ params) here; the step translates them when rendering,
// so they follow a language change. Labels and hints are the messages
// "setup.account.fields.<name>.*".

export type AccountFieldName = Exclude<keyof SetupInput, "setupToken" | "locale">;
export type AccountErrors = Partial<Record<AccountFieldName, FieldError>>;

export interface AccountFieldConfig {
  name: AccountFieldName;
  type?: "text" | "email" | "password";
  autoComplete: string;
  // Spans both columns of the two-column layout.
  wide?: boolean;
}

// Rendered in this order; the first invalid one receives focus.
export const ACCOUNT_FIELDS: readonly AccountFieldConfig[] = [
  { name: "displayName", autoComplete: "name" },
  { name: "username", autoComplete: "username" },
  { name: "email", type: "email", autoComplete: "email", wide: true },
  { name: "password", type: "password", autoComplete: "new-password" },
  { name: "passwordConfirm", type: "password", autoComplete: "new-password" },
];

const FIELD_NAMES = new Set<string>(ACCOUNT_FIELDS.map((field) => field.name));

export function isAccountField(name: string): name is AccountFieldName {
  return FIELD_NAMES.has(name);
}

export function readAccountValues(form: HTMLFormElement): Record<AccountFieldName, string> {
  const data = new FormData(form);
  const read = (name: AccountFieldName) => String(data.get(name) ?? "");
  return {
    displayName: read("displayName"),
    username: read("username"),
    email: read("email"),
    password: read("password"),
    passwordConfirm: read("passwordConfirm"),
  };
}

// Keeps the errors that belong to a field of this form; `other` collects the
// rest, e.g. "body", "setupToken" or "locale".
export function splitFieldErrors(fields: FieldErrors): {
  errors: AccountErrors;
  other: FieldErrors;
} {
  const errors: AccountErrors = {};
  const other: FieldErrors = {};
  for (const [name, error] of Object.entries(fields)) {
    if (isAccountField(name)) errors[name] ??= error;
    else other[name] = error;
  }
  return { errors, other };
}

export type AccountValidation =
  | { ok: true; input: SetupInput }
  | { ok: false; errors: AccountErrors; other: FieldErrors };

// `locale` is the language the wizard is shown in; the server action sends
// the request's locale again (actions.ts), this only completes the input.
export function validateAccount(
  values: Record<AccountFieldName, string>,
  setupToken: string,
  locale: string,
): AccountValidation {
  const parsed = setupInputSchema.safeParse({ ...values, setupToken, locale });
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, ...splitFieldErrors(fieldErrorsFromZod(parsed.error)) };
}

export function firstInvalidField(errors: AccountErrors): AccountFieldName | undefined {
  return ACCOUNT_FIELDS.find((field) => errors[field.name])?.name;
}
