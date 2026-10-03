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

// Parses the request body as JSON; undefined when it is not valid JSON.
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
