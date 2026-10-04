import {
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
  "reauthentication_required",
  "validation",
  "name_taken",
  "forbidden",
  "folder_not_found",
  "not_found",
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

function readScope(value: unknown): ApiTokenInfo["folderScope"] | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const scope = value.map((entry) =>
    isRecord(entry) && isString(entry.id) && isOptionalString(entry.path)
      ? { id: entry.id, path: entry.path as string | null }
      : undefined,
  );
  return scope.every((entry) => entry !== undefined) ? scope : undefined;
}

export function readTokenInfo(value: unknown): ApiTokenInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, prefix, permissions, expiresAt, lastUsedAt, createdAt, revokedAt } = value;
  if (!isString(id) || !isString(name) || !isString(prefix) || !isString(createdAt)) return;
  if (![expiresAt, lastUsedAt, revokedAt].every(isOptionalString)) return undefined;
  if (!Array.isArray(permissions)) return undefined;
  const known = NOTE_PERMISSIONS.filter((permission) => permissions.includes(permission));
  const folderScope = readScope(value.folderScope);
  if (folderScope === undefined) return undefined;
  return {
    id,
    name,
    prefix,
    permissions: known as NotePermission[],
    folderScope,
    expiresAt: expiresAt as string | null,
    lastUsedAt: lastUsedAt as string | null,
    createdAt,
    revokedAt: revokedAt as string | null,
  };
}
