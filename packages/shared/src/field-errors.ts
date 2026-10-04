import type { z } from "zod";

// Field errors as codes instead of sentences. The API returns them and the web
// app translates them (one message per code, with `params` as placeholders).
// The shared schemas put the code into each check's message; fieldErrorsFromZod
// turns a failed parse into the shape the API sends.

export const FIELD_ERROR_CODES = [
  // No value was sent (or only whitespace where a value is trimmed and the
  // form treats a blank field as not filled in).
  "required",
  // A value was sent, but it is empty or only whitespace where a value is
  // trimmed (the notes API and MCP tell this apart from a missing value).
  "empty",
  // A value was sent, but not of the expected type (e.g. a number for a text field).
  "invalid_type",
  // params: { min } – shortest allowed length.
  "too_short",
  // params: { max } – longest allowed length.
  "too_long",
  // The text does not have the required form. For the setup token,
  // params: { length } – number of characters.
  "invalid_format",
  "invalid_email",
  // Not one of the allowed values (e.g. a locale code that is not well-formed).
  "invalid_option",
  // Does not match the field it repeats (password confirmation).
  "mismatch",
  // Already used by another account (409 conflict: email, username).
  "taken",
  // The request body is not a JSON object (field "body").
  "invalid_body",
  // Fallback for a problem without a more specific code.
  "invalid",
] as const;

export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

export type FieldErrorParams = Record<string, number | string>;

export interface FieldError {
  code: FieldErrorCode;
  params?: FieldErrorParams;
}

// Keyed by the input's top-level field name; problems with the input as a
// whole use the key "body".
export type FieldErrors = Record<string, FieldError>;

const CODES = new Set<string>(FIELD_ERROR_CODES);

export function isFieldErrorCode(value: unknown): value is FieldErrorCode {
  return typeof value === "string" && CODES.has(value);
}

// Error map for a field that must be present: "required" when the value is
// missing, `otherwise` when one was sent but rejected by the type itself.
export function requiredOr(otherwise: FieldErrorCode) {
  return (issue: { input?: unknown }): FieldErrorCode =>
    issue.input === undefined || issue.input === null ? "required" : otherwise;
}

function toParams(value: unknown): FieldErrorParams | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const params: FieldErrorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" || typeof entry === "string") params[key] = entry;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function toFieldError(issue: z.core.$ZodIssue): FieldError {
  const code = isFieldErrorCode(issue.message) ? issue.message : "invalid";
  if (code === "too_short" && issue.code === "too_small") {
    return { code, params: { min: Number(issue.minimum) } };
  }
  if (code === "too_long" && issue.code === "too_big") {
    return { code, params: { max: Number(issue.maximum) } };
  }
  const params = issue.code === "custom" ? toParams(issue.params) : undefined;
  return params ? { code, params } : { code };
}

// First problem per field, in the schema's order of checks.
export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "body";
    fields[key] ??= toFieldError(issue);
  }
  return fields;
}
