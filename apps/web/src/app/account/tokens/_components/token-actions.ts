"use server";

import {
  type ApiTokenInfo,
  type CreatedApiToken,
  type McpServersConfig,
  mcpServersConfig,
} from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { currentMcpUrl } from "@/lib/api-tokens/mcp-address";
import {
  readTokenFailure,
  readTokenInfo,
  type TokenFailure,
  tokenFailure,
} from "@/lib/api-tokens/token-result";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { EXPIRY_DAYS, type TokenDraft } from "./token-draft";

// Creating and revoking API tokens (/api/tokens/v1, session only). The new
// token travels only in the result of createApiToken, which the page shows
// once and keeps in memory; it is never logged, cached or stored. Creating
// one needs the password confirmed recently; the API server decides that and
// answers reauthentication_required, which opens the password dialog.

export type CreateResult =
  | { ok: true; info: ApiTokenInfo; config: McpServersConfig }
  | TokenFailure;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function createApiToken(draft: TokenDraft): Promise<CreateResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return tokenFailure("unauthenticated");
  const days = EXPIRY_DAYS.find((value) => value === draft?.expiryDays);
  const response = await callServer("/api/tokens/v1/tokens", {
    method: "POST",
    headers: { authorization },
    body: {
      name: draft?.name,
      permissions: draft?.permissions,
      folderScope: draft?.folderScope ?? null,
      expiresAt: days ? new Date(Date.now() + days * DAY_MS).toISOString() : null,
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

export async function revokeApiToken(id: string): Promise<{ ok: true } | TokenFailure> {
  const authorization = await sessionAuthorization();
  if (!authorization) return tokenFailure("unauthenticated");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return tokenFailure("not_found");
  const response = await callServer(`/api/tokens/v1/tokens/${id}`, {
    method: "DELETE",
    headers: { authorization },
  });
  return response.reachable && response.status === 200 ? { ok: true } : readTokenFailure(response);
}
