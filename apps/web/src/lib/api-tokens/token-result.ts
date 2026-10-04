import {
  type ApiTokenEntryInfo,
  type ApiTokenInfo,
  type FieldErrors,
  NOTE_PERMISSIONS,
  type NotePermission,
} from "@hexmark/shared";
import { isRecord, readFieldErrors } from "@/lib/api-fields";
import type { ServerResponse } from "@/lib/server-api";

// Answers of /api/tokens/v1 as the token page gets them, checked field by
// field. Refusals are codes the page translates ("tokens.errors.<code>").
// Contract: apps/server/src/api/tokens/v1/index.ts.

export const TOKEN_ERROR_CODES = [
  "unauthenticated",
  "validation",
  "name_taken",
  "forbidden",
  "folder_not_found",
  "not_found",
  "reauthentication_required",
  "setup_token_present",
  "database_unavailable",
  "server_not_configured",
  "server_unreachable",
  "unexpected",
] as const;

export type TokenErrorCode = (typeof TOKEN_ERROR_CODES)[number];

export interface TokenFailure {
  ok: false;
  error: TokenErrorCode;
  fields: FieldErrors;
}

export function tokenFailure(error: TokenErrorCode, fields: FieldErrors = {}): TokenFailure {
  return { ok: false, error, fields };
}

// The refusal in `response`; anything this app does not know is "unexpected".
export function readTokenFailure(response: ServerResponse): TokenFailure {
  if (!response.reachable) return tokenFailure("server_unreachable");
  const body = isRecord(response.body) ? response.body : {};
  const code = TOKEN_ERROR_CODES.find((known) => known === body.error) ?? "unexpected";
  if (code === "name_taken") return tokenFailure(code, { name: { code: "taken" } });
  return tokenFailure(code, code === "validation" ? readFieldErrors(body.fields) : {});
}

const isString = (value: unknown): value is string => typeof value === "string";
const isOptionalString = (value: unknown) => value === null || isString(value);

function readPermissions(value: unknown): NotePermission[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return NOTE_PERMISSIONS.filter((permission) => value.includes(permission));
}

function readEntry(value: unknown): ApiTokenEntryInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { id, kind, targetId, path, targetTrashed, permissions } = value;
  if (!isString(id) || !isString(targetId) || !isString(path)) return undefined;
  if (kind !== "folder" && kind !== "note") return undefined;
  const list = permissions === null ? null : readPermissions(permissions);
  if (list === undefined) return undefined;
  return { id, kind, targetId, path, targetTrashed: targetTrashed === true, permissions: list };
}

export function readTokenInfo(value: unknown): ApiTokenInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, prefix, mode, expiresAt, lastUsedAt, createdAt, revokedAt } = value;
  if (!isString(id) || !isString(name) || !isString(prefix) || !isString(createdAt)) return;
  if (![expiresAt, lastUsedAt, revokedAt].every(isOptionalString)) return undefined;
  if (mode !== "allow_list" && mode !== "deny_list") return undefined;
  const base = value.basePermissions === null ? null : readPermissions(value.basePermissions);
  if (base === undefined || !Array.isArray(value.entries)) return undefined;
  const entries = value.entries.map(readEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  return {
    id,
    name,
    prefix,
    mode,
    basePermissions: base,
    entries: entries as ApiTokenEntryInfo[],
    expiresAt: expiresAt as string | null,
    lastUsedAt: lastUsedAt as string | null,
    createdAt,
    revokedAt: revokedAt as string | null,
  };
}
