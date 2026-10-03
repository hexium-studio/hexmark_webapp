import type { FieldErrors } from "@hexmark/shared";
import { isRecord, readFieldErrors } from "@/lib/api-fields";
import type { ServerResponse } from "@/lib/server-api";

// Result of a setup server action, reduced to what the wizard needs. The
// codes follow the API's `error` values (apps/server/src/routes/setup*.ts);
// "setup_closed" is the API's 404 not_found.

export type SetupErrorCode =
  | "invalid_token"
  | "rate_limited"
  | "setup_token_not_configured"
  | "server_not_configured"
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
  server_not_configured: "server_not_configured",
  database_unavailable: "database_unavailable",
  not_found: "setup_closed",
  validation: "validation",
  conflict: "conflict",
};

export function toSetupActionResult(
  response: ServerResponse,
  successStatus: number,
): SetupActionResult {
  if (!response.reachable) return { ok: false, error: "server_unreachable", fields: {} };
  if (response.status === successStatus) return { ok: true };
  const body = isRecord(response.body) ? response.body : {};
  const code = typeof body.error === "string" ? KNOWN_ERRORS[body.error] : undefined;
  return { ok: false, error: code ?? "unexpected", fields: readFieldErrors(body.fields) };
}
