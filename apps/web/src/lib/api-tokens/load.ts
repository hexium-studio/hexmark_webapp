import { type ApiTokenInfo, TREE_DEPTH_LIMITS } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { loadAccountSecurity } from "@/lib/two-factor/account-security";
import { type FolderChoice, readFolderChoices } from "./folders";
import { readTokenInfo } from "./token-result";

// Everything the token page shows, for the signed-in user of the current
// request: the tokens, the folders a new one can be limited to, the
// account's time zone and until when the password confirmation lasts.
// Server code only.

export interface TokensPageData {
  // Revoked tokens are left out: they can do nothing any more.
  tokens: ApiTokenInfo[];
  folders: FolderChoice[];
  timezone: string;
  reauthenticatedUntil: string | null;
}

export type TokensPageResult =
  | { kind: "ok"; data: TokensPageData }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

async function get(path: string, authorization: string) {
  const response = await callServer(path, { headers: { authorization } });
  if (!response.reachable) return { status: 0, body: null };
  return { status: response.status, body: response.body };
}

export async function loadTokensPage(): Promise<TokensPageResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return { kind: "unauthenticated" };
  const [list, tree, security] = await Promise.all([
    get("/api/tokens/v1/tokens", authorization),
    get(`/api/notes/v1/tree?depth=${TREE_DEPTH_LIMITS.max}`, authorization),
    loadAccountSecurity(),
  ]);
  if (list.status === 401 || tree.status === 401 || security.kind === "unauthenticated") {
    return { kind: "unauthenticated" };
  }
  if (list.status !== 200 || tree.status !== 200 || security.kind !== "ok") {
    return { kind: "unavailable" };
  }
  const raw = isRecord(list.body) && Array.isArray(list.body.tokens) ? list.body.tokens : null;
  const tokens = raw?.map(readTokenInfo);
  const folders = readFolderChoices(tree.body);
  if (!tokens || tokens.some((token) => !token) || !folders) return { kind: "unavailable" };
  return {
    kind: "ok",
    data: {
      tokens: (tokens as ApiTokenInfo[]).filter((token) => token.revokedAt === null),
      folders,
      timezone: security.security.timezone,
      reauthenticatedUntil: security.security.reauthenticatedUntil,
    },
  };
}
