import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TOKENS_BODY_LIMIT_BYTES } from "../../../config/notes";
import { postToken } from "./create";
import { getTokens } from "./list";
import { deleteToken } from "./revoke";
import { patchToken } from "./update";

// API tokens for agents, version 1. Mounted at /api/tokens/v1
// (src/api/index.ts). Types: packages/shared/src/api-tokens.ts.
//
// Every endpoint: header `Authorization: Session <token>` (the web app; an
// API token is refused with 401 unauthenticated). Only the caller's own
// tokens are visible. A token is "hmk_" + 43 characters; it is returned once
// and only its digest is stored. The columns permissions and folder_scope
// are legacy (migration 0010 converted them; neither read nor written; a
// later migration drops them).
// Marked (R): needs the password re-entered in this session within the last
// 10 minutes (POST /api/auth/v1/reauthenticate), else 403
// { error: "reauthentication_required" }; checked on the locked session row
// in the same transaction as the write. Revoking needs no re-entry.
//
// GET /tokens
//   200 { tokens: [{ id, name, prefix, mode, basePermissions, entries: [{ id, kind,
//         targetId, path, targetTrashed, permissions }], expiresAt, lastUsedAt,
//         createdAt, revokedAt }] }  newest first, revoked ones included. mode
//       "allow_list": only the entries' targets (a folder with everything below it, or a
//       single note), each with its own permissions; basePermissions null.
//       "deny_list": everything except the entries' targets, with basePermissions;
//       entries carry no permissions. path: the target's path now (where it was when it
//       is in the trash, targetTrashed true: the entry applies again on restore). An
//       entry whose target is deleted for good is removed (audit token.entry_removed).
// POST /tokens  (R) body { name (1-64), mode: "allow_list" | "deny_list" (required, no
//       default), basePermissions?: permission[] (deny_list: required; allow_list: not
//       allowed), entries?: [{ kind: "folder" | "note", id, permissions? }] (at most 200;
//       allow_list: at least one, each with permissions; deny_list: without), expiresAt?:
//       ISO 8601 | null }. Permissions: "read", "search", "create", "edit", "move",
//       "delete", "lock"; a note entry only "read", "edit", "move", "delete", "lock".
//   201 { token, info, mcp: { serverName: "hexmark", url, config } }
//       `token` is shown this once. `mcp.url` is MCP_PUBLIC_URL, or null when
//       it is not set: the web app then builds the address from its request
//       host and SERVER_PORT (http(s)://<host>:<SERVER_PORT>/mcp) and the
//       block with mcpServersConfig from @hexmark/shared. `mcp.config` is the
//       ready block { mcpServers: { hexmark: { type: "http", url, headers:
//       { Authorization: "Bearer <token>" } } } } when the url is known, else null.
//   400 validation (name, mode, basePermissions, entries { index }: required,
//       invalid (a duplicate target, permissions on a deny_list entry),
//       invalid_option (a permission a note entry cannot carry); expiresAt: invalid
//       when not in the future); 403 reauthentication_required; 403 forbidden
//       { permissions } (beyond the owner's role, e.g. a guest asking for edit);
//       404 folder_not_found { folderIds } | not_found { noteIds } (a new target that
//       is not in use); 409 name_taken (names are unique per user, also among
//       revoked tokens)
// PATCH /tokens/:id  (R) body { mode?, basePermissions?, entries?, expiresAt? } (left
//       out: unchanged; entries replaces the whole list; a new mode needs entries, and
//       basePermissions for deny_list, in the same request: all old entries are
//       replaced in one transaction). Same rules and refusals as POST; an entry kept
//       from before may point at a target in the trash. Applies to the very next
//       request of the token. Logged as token.updated with what changed: mode,
//       basePermissions, expiresAt ({ before, after }), addedEntries, removedEntries,
//       changedEntries (with permissions before and after).
//   200 { token }; 404 not_found (not one of the caller's tokens)
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
tokensV1.patch("/tokens/:id", patchToken);
tokensV1.delete("/tokens/:id", deleteToken);
