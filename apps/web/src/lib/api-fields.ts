import { type FieldErrors, isFieldErrorCode } from "@hexmark/shared";

// Reading the `fields` of an API error body ({ <field>: { code, params? } }),
// for every form that forwards to the API server.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readParams(value: unknown): Record<string, number | string> | undefined {
  if (!isRecord(value)) return undefined;
  const params: Record<string, number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" || typeof entry === "string") params[key] = entry;
  }
  return params;
}

// Keeps the entries that have a known code; anything else is dropped.
export function readFieldErrors(value: unknown): FieldErrors {
  if (!isRecord(value)) return {};
  const fields: FieldErrors = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isFieldErrorCode(entry.code)) continue;
    const params = readParams(entry.params);
    fields[key] = params ? { code: entry.code, params } : { code: entry.code };
  }
  return fields;
}
