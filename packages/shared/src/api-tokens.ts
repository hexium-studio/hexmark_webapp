import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import { idSchema, NOTE_PERMISSIONS, type NotePermission } from "./notes";

// API tokens for agents: format, the input of POST /api/tokens/v1/tokens and
// the shapes of the answers (apps/server/src/api/tokens/v1/index.ts).

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

export const notePermissionSchema = z.enum(NOTE_PERMISSIONS, { error: code("invalid_option") });

export const createApiTokenInputSchema = z.object({
  name: apiTokenNameSchema,
  permissions: z
    .array(notePermissionSchema, { error: requiredOr("invalid_type") })
    .min(1, code("required"))
    .transform((list) => NOTE_PERMISSIONS.filter((permission) => list.includes(permission))),
  // Null or missing: the whole wiki; otherwise these folders and their subfolders.
  folderScope: z
    .array(idSchema, { error: code("invalid_type") })
    .min(1, code("required"))
    .max(100, code("too_long"))
    .transform((list) => [...new Set(list)])
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  // ISO 8601 with a time zone; null or missing: never expires.
  expiresAt: z.iso
    .datetime({ offset: true, error: code("invalid_format") })
    .nullable()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenInputSchema>;

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  permissions: NotePermission[];
  // Null: the whole wiki.
  folderScope: { id: string; path: string | null }[] | null;
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
