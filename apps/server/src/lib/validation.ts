import { type FieldErrors, fieldErrorsFromZod } from "@hexmark/shared";
import type { Context } from "hono";
import type { z } from "zod";

// Body of a 400 response: one error code (+ params) per field, keyed by the
// input's top-level field name. Problems with the body as a whole use the key
// "body". The codes are defined in @hexmark/shared (field-errors.ts).
export interface ValidationErrorBody {
  error: "validation";
  fields: FieldErrors;
}

export function validationError(fields: FieldErrors): ValidationErrorBody {
  return { error: "validation", fields };
}

// The body is not a JSON object, so no field could be checked.
export function invalidBodyError(): ValidationErrorBody {
  return validationError({ body: { code: "invalid_body" } });
}

// First problem per field, in the schema's order of checks.
export function zodValidationError(error: z.ZodError): ValidationErrorBody {
  return validationError(fieldErrorsFromZod(error));
}

// The parsed body is a JSON object (not an array, null or a primitive).
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Parses the request body as JSON; undefined when it is not valid JSON.
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

// Reads the JSON body and checks it against `schema`: the parsed value, or
// the 400 response to send.
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  const body = await readJsonBody(c);
  if (!isJsonObject(body)) return { ok: false, response: c.json(invalidBodyError(), 400) };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: c.json(zodValidationError(parsed.error), 400) };
  }
  return { ok: true, data: parsed.data };
}
