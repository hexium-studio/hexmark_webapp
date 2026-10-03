import { type FieldErrors, isFieldErrorCode } from "@hexmark/shared";
import type { ServerResponse } from "@/lib/server-api";

// Result of a setup server action, reduced to what the wizard needs. The
// codes follow the API's `error` values (apps/server/src/routes/setup*.ts);
// "setup_closed" is the API's 404 not_found.

export type SetupErrorCode =
  | "invalid_token"
  | "rate_limited"
  | "setup_token_not_configured"
  | "database_unavailable"
  | "setup_closed"
  | "validation"
  | "conflict"
  | "server_unreachable"
  | "unexpected";

export type SetupActionResult =
  | { ok: true }
  // `fields`: one error code (+ params) per input field (validation, conflict).
  | { ok: false; error: SetupErrorCode; fields: FieldErrors };

const KNOWN_ERRORS: Record<string, SetupErrorCode> = {
  invalid_token: "invalid_token",
  rate_limited: "rate_limited",
  setup_token_not_configured: "setup_token_not_configured",
  database_unavailable: "database_unavailable",
  not_found: "setup_closed",
  validation: "validation",
  conflict: "conflict",
};

function isRecord(value: unknown): value is Record<string, unknown> {
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
function readFields(value: unknown): FieldErrors {
  if (!isRecord(value)) return {};
  const fields: FieldErrors = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isFieldErrorCode(entry.code)) continue;
    const params = readParams(entry.params);
    fields[key] = params ? { code: entry.code, params } : { code: entry.code };
  }
  return fields;
}

export function toSetupActionResult(
  response: ServerResponse,
  successStatus: number,
): SetupActionResult {
  if (!response.reachable) return { ok: false, error: "server_unreachable", fields: {} };
  if (response.status === successStatus) return { ok: true };
  const body = isRecord(response.body) ? response.body : {};
  const code = typeof body.error === "string" ? KNOWN_ERRORS[body.error] : undefined;
  return { ok: false, error: code ?? "unexpected", fields: readFields(body.fields) };
}
