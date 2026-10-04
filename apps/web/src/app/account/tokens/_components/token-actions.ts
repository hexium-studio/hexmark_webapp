"use server";

import {
  type ApiTokenInfo,
  type CreatedApiToken,
  type McpServersConfig,
  mcpServersConfig,
  TREE_DEPTH_LIMITS,
} from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { currentMcpUrl } from "@/lib/api-tokens/mcp-address";
import {
  readTokenFailure,
  readTokenInfo,
  type TokenFailure,
  tokenFailure,
} from "@/lib/api-tokens/token-result";
import { type PickerTree, readPickerTree } from "@/lib/api-tokens/tree";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { accessBody, expiryOf, type TokenDraft } from "./token-draft";

// Creating, changing and revoking API tokens (/api/tokens/v1, session
// only), and loading a folder of the target tree when it is opened. The new
// token travels only in the result of createApiToken, which the page shows
// once and keeps in memory; it is never logged, cached or stored. Creating
// or changing one needs the password confirmed recently; the API server
// decides that and answers reauthentication_required, which opens the
// password dialog.

export type CreateResult =
  | { ok: true; info: ApiTokenInfo; config: McpServersConfig }
  | TokenFailure;

export async function createApiToken(draft: TokenDraft): Promise<CreateResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return tokenFailure("unauthenticated");
  const response = await callServer("/api/tokens/v1/tokens", {
    method: "POST",
    headers: { authorization },
    body: {
      name: draft?.name,
      ...accessBody(draft.access),
      expiresAt: expiryOf(draft.expiry === "keep" ? null : draft.expiry) ?? null,
    },
  });
  if (!response.reachable || response.status !== 201) return readTokenFailure(response);
  const body = (isRecord(response.body) ? response.body : {}) as Partial<CreatedApiToken>;
  const info = readTokenInfo(body.info);
  const token = body.token;
  if (!info || typeof token !== "string") return tokenFailure("unexpected");
  const url = typeof body.mcp?.url === "string" ? body.mcp.url : await currentMcpUrl();
  if (!url) return tokenFailure("unexpected");
  // The server's block when it knows the address, else the same block built
  // with the address derived here.
  const config = body.mcp?.config ?? mcpServersConfig(url, token);
  return { ok: true, info, config };
}

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

export async function updateApiToken(
  id: string,
  draft: Omit<TokenDraft, "name">,
): Promise<{ ok: true; info: ApiTokenInfo } | TokenFailure> {
  const authorization = await sessionAuthorization();
  if (!authorization) return tokenFailure("unauthenticated");
  if (!isId(id)) return tokenFailure("not_found");
  const response = await callServer(`/api/tokens/v1/tokens/${id}`, {
    method: "PATCH",
    headers: { authorization },
    body: { ...accessBody(draft.access), expiresAt: expiryOf(draft.expiry) },
  });
  if (!response.reachable || response.status !== 200) return readTokenFailure(response);
  const body = isRecord(response.body) ? response.body : {};
  const info = readTokenInfo(body.token);
  return info ? { ok: true, info } : tokenFailure("unexpected");
}

// A folder's contents for the target tree, when it was not loaded yet.
export async function loadTreeFolder(folderId: string): Promise<PickerTree | null> {
  const authorization = await sessionAuthorization();
  if (!authorization || !isId(folderId)) return null;
  const response = await callServer(
    `/api/notes/v1/tree?folder=${folderId}&depth=${TREE_DEPTH_LIMITS.max}`,
    { headers: { authorization } },
  );
  if (!response.reachable || response.status !== 200) return null;
  return readPickerTree(response.body) ?? null;
}

export async function revokeApiToken(id: string): Promise<{ ok: true } | TokenFailure> {
  const authorization = await sessionAuthorization();
  if (!authorization) return tokenFailure("unauthenticated");
  if (!isId(id)) return tokenFailure("not_found");
  const response = await callServer(`/api/tokens/v1/tokens/${id}`, {
    method: "DELETE",
    headers: { authorization },
  });
  return response.reachable && response.status === 200 ? { ok: true } : readTokenFailure(response);
}
