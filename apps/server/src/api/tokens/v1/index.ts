import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TOKENS_BODY_LIMIT_BYTES } from "../../../config/notes";
import { postToken } from "./create";
import { getTokens } from "./list";
import { deleteToken } from "./revoke";

// API tokens for agents, version 1. Mounted at /api/tokens/v1
// (src/api/index.ts). Types: packages/shared/src/api-tokens.ts.
//
// Every endpoint: header `Authorization: Session <token>` (the web app; an
// API token is refused with 401 unauthenticated). Only the caller's own
// tokens are visible. A token is "hmk_" + 43 characters; it is returned once
// and only its digest is stored.
// Marked (R): needs the password re-entered in this session within the last
// 10 minutes (POST /api/auth/v1/reauthenticate), else 403
// { error: "reauthentication_required" }; checked on the locked session row
// in the same transaction as the write. Revoking needs no re-entry.
//
// GET /tokens
//   200 { tokens: [{ id, name, prefix, permissions, folderScope: [{ id, path }]
//         | null, expiresAt, lastUsedAt, createdAt, revokedAt }] }  newest first,
//       revoked ones included. folderScope paths are null for folders that
//       no longer exist.
// POST /tokens  (R) body { name (1-64), permissions: ["read", "search", "create",
//       "edit", "move", "delete", "lock"] (at least one), folderScope?: uuid[]
//       | null (null: the whole wiki), expiresAt?: ISO 8601 | null }
//   201 { token, info, mcp: { serverName: "hexmark", url, config } }
//       `token` is shown this once. `mcp.url` is MCP_PUBLIC_URL, or null when
//       it is not set: the web app then builds the address from its request
//       host and SERVER_PORT (http(s)://<host>:<SERVER_PORT>/mcp) and the
//       block with mcpServersConfig from @hexmark/shared. `mcp.config` is the
//       ready block { mcpServers: { hexmark: { type: "http", url, headers:
//       { Authorization: "Bearer <token>" } } } } when the url is known, else null.
//   400 validation (name, permissions, folderScope, expiresAt: invalid when
//       not in the future); 403 reauthentication_required; 403 forbidden { permissions } (beyond the owner's
//       role, e.g. a guest asking for edit); 404 folder_not_found { folderIds };
//       409 name_taken (names are unique per user, also among revoked tokens)
// DELETE /tokens/:id
//   200 { token }  revoked at once (every request checks the token's row);
//       revoking again changes nothing. 404 not_found
//
// All endpoints: 401 unauthenticated, 403 setup_token_present, 413
// payload_too_large, 503 database_unavailable or server_not_configured.
// Responses are Cache-Control: no-store.

export const tokensV1 = new Hono();

tokensV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

tokensV1.use(
  "*",
  bodyLimit({
    maxSize: TOKENS_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

tokensV1.get("/tokens", getTokens);
tokensV1.post("/tokens", postToken);
tokensV1.delete("/tokens/:id", deleteToken);
