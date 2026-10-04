import { z } from "zod";
import {
  type ApiTokenAccessMode,
  type ApiTokenEntryInfo,
  accessModeSchema,
  permissionSetSchema,
  tokenEntriesSchema,
} from "./api-token-access";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import type { NotePermission } from "./notes";

// API tokens for agents: format, the input of POST /api/tokens/v1/tokens and
// PATCH, and the shapes of the answers (apps/server/src/api/tokens/v1/index.ts).

// "hmk_" + 32 random bytes as base64url without padding.
export const API_TOKEN_PREFIX = "hmk_";
export const API_TOKEN_PATTERN = /^hmk_[A-Za-z0-9_-]{43}$/;
// Characters kept for recognising a token in a list ("hmk_3f9a").
export const API_TOKEN_SHOWN_PREFIX_LENGTH = 8;

// Agents send `Authorization: Bearer <token>`.
export const BEARER_AUTH_SCHEME = "Bearer";

export const API_TOKEN_NAME_MAX_LENGTH = 64;

const code = (value: FieldErrorCode) => value;

// Shown as the actor name of the agent's changes, so no control characters.
export const apiTokenNameSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(1, code("required"))
  .max(API_TOKEN_NAME_MAX_LENGTH, code("too_long"))
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), { message: code("invalid_format") });

// ISO 8601 with a time zone; null: never expires.
const expirySchema = z.iso
  .datetime({ offset: true, error: code("invalid_format") })
  .nullable()
  .transform((value) => (value ? new Date(value) : null));

// POST /api/tokens/v1/tokens. The mode has no default: it decides what the
// token can reach, so it is chosen every time (api-token-access.ts).
export const createApiTokenInputSchema = z.object({
  name: apiTokenNameSchema,
  mode: accessModeSchema,
  // deny_list only: the permissions for everything not excluded.
  basePermissions: permissionSetSchema.nullable().optional(),
  entries: tokenEntriesSchema.optional().transform((list) => list ?? []),
  expiresAt: expirySchema.optional().transform((value) => value ?? null),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenInputSchema>;

// PATCH /api/tokens/v1/tokens/:id. Left out: unchanged. `entries` replaces
// the whole list; a new mode needs the new list (and, for deny_list, the
// base permissions) in the same request.
export const updateApiTokenInputSchema = z.object({
  mode: accessModeSchema.optional(),
  basePermissions: permissionSetSchema.nullable().optional(),
  entries: tokenEntriesSchema.optional(),
  expiresAt: expirySchema.optional(),
});
export type UpdateApiTokenInput = z.infer<typeof updateApiTokenInputSchema>;

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  mode: ApiTokenAccessMode;
  // deny_list: the permissions for everything not excluded; null for allow_list.
  basePermissions: NotePermission[] | null;
  entries: ApiTokenEntryInfo[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

// Key of Hexmark in an MCP client's mcpServers configuration.
export const MCP_SERVER_NAME = "hexmark";

// The block shown once after creating a token, in the mcpServers JSON format
// MCP clients read (no prose, language-neutral). Built here so the server and
// the web app (which fills in the address when the server does not know it)
// produce the same block.
export function mcpServersConfig(url: string, token: string) {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url,
        headers: { Authorization: `${BEARER_AUTH_SCHEME} ${token}` },
      },
    },
  };
}

export type McpServersConfig = ReturnType<typeof mcpServersConfig>;

// 201 from POST /api/tokens/v1/tokens: the only time the token is shown.
// `mcp.url` is the server's MCP_PUBLIC_URL; null when it is not set: the
// server cannot know which host clients reach it under, so the web app builds
// the address from its own request host and SERVER_PORT (".../mcp") and the
// block with mcpServersConfig. `config` is that block when the url is known.
export interface CreatedApiToken {
  token: string;
  info: ApiTokenInfo;
  mcp: { serverName: string; url: string | null; config: McpServersConfig | null };
}
