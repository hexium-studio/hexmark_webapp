import {
  type FieldError,
  type FieldErrors,
  fieldErrorsFromZod,
  type LoginInput,
  loginInputSchema,
} from "@hexmark/shared";

// Fields of the sign-in form and their check with the shared schema, so the
// browser refuses exactly what the API server would refuse. Errors stay
// codes (+ params); the form translates them when rendering.

export type SignInFieldName = "email" | "password";
export type SignInErrors = Partial<Record<SignInFieldName, FieldError>>;

// The form's input fields, in the order they are rendered.
export const SIGN_IN_FIELDS: readonly SignInFieldName[] = ["email", "password"];

export interface SignInValues {
  email: string;
  password: string;
  remember: boolean;
}

export const EMPTY_SIGN_IN_VALUES: SignInValues = { email: "", password: "", remember: false };

export function readSignInValues(form: HTMLFormElement): SignInValues {
  const data = new FormData(form);
  return {
    email: String(data.get("email") ?? ""),
    password: String(data.get("password") ?? ""),
    remember: data.get("remember") !== null,
  };
}

// Keeps the errors of this form's fields (the API may also report "body"
// or "remember", which nobody can fix in the form).
export function pickSignInErrors(fields: FieldErrors): SignInErrors {
  const errors: SignInErrors = {};
  for (const name of SIGN_IN_FIELDS) if (fields[name]) errors[name] = fields[name];
  return errors;
}

export type SignInValidation =
  | { ok: true; input: LoginInput }
  | { ok: false; errors: SignInErrors };

export function validateSignIn(values: SignInValues): SignInValidation {
  const parsed = loginInputSchema.safeParse(values);
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, errors: pickSignInErrors(fieldErrorsFromZod(parsed.error)) };
}
