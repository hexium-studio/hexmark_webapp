import { type ApiTokenInfo, TREE_DEPTH_LIMITS } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { loadAccountSecurity } from "@/lib/two-factor/account-security";
import { readTokenInfo } from "./token-result";
import { type PickerTree, readPickerTree } from "./tree";

// Everything the token page shows, for the signed-in user of the current
// request: the tokens, the folders and notes a token's targets are picked
// from, the account's time zone and until when the password confirmation
// lasts.
// Server code only.

export interface TokensPageData {
  // Revoked tokens are left out: they can do nothing any more.
  tokens: ApiTokenInfo[];
  tree: PickerTree;
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
  const picker = readPickerTree(tree.body);
  if (!tokens || tokens.some((token) => !token) || !picker) return { kind: "unavailable" };
  return {
    kind: "ok",
    data: {
      tokens: (tokens as ApiTokenInfo[]).filter((token) => token.revokedAt === null),
      tree: picker,
      timezone: security.security.timezone,
      reauthenticatedUntil: security.security.reauthenticatedUntil,
    },
  };
}
