import {
  type AuthUser,
  isLocale,
  SESSION_AUTH_SCHEME,
  USER_ROLES,
  type UserRole,
} from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { callServer, type ServerResponse } from "@/lib/server-api";

// GET /api/auth/v1/me, server to server: is the session token still good,
// and whose is it. Contract: apps/server/src/api/auth/v1/index.ts.

// Called before every page; the page waits for it, so keep it short.
const ME_TIMEOUT_MS = 3_000;

export type MeResult =
  | {
      kind: "valid";
      user: AuthUser;
      // The token was replaced: the caller must store this one in the cookie.
      rotatedToken?: string;
      expiresAt: string;
      remember: boolean;
    }
  // 401: no live session for the token. Delete the cookie.
  | { kind: "invalid" }
  // No usable answer (server down, 503, 5xx, unknown body). Keep the cookie:
  // the session may well be fine once the server answers again.
  | { kind: "unavailable" };

function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

// The user object of /me and /login, checked field by field.
export function readAuthUser(value: unknown): AuthUser | undefined {
  if (!isRecord(value)) return undefined;
  const { id, displayName, username, role, locale } = value;
  if (
    typeof id !== "string" ||
    typeof displayName !== "string" ||
    typeof username !== "string" ||
    !isLocale(locale) ||
    !isRole(role)
  ) {
    return undefined;
  }
  return { id, displayName, username, role, locale };
}

export function toMeResult(response: ServerResponse): MeResult {
  if (!response.reachable) return { kind: "unavailable" };
  if (response.status === 401) return { kind: "invalid" };
  if (response.status !== 200 || !isRecord(response.body)) return { kind: "unavailable" };
  const user = readAuthUser(response.body.user);
  const session = response.body.session;
  if (!user || !isRecord(session)) return { kind: "unavailable" };
  const { rotatedToken, expiresAt, remember } = session;
  if (typeof expiresAt !== "string" || typeof remember !== "boolean") {
    return { kind: "unavailable" };
  }
  return {
    kind: "valid",
    user,
    ...(typeof rotatedToken === "string" ? { rotatedToken } : {}),
    expiresAt,
    remember,
  };
}

// `clientIp` as in callServer(): the request proxy passes the address it
// resolved; elsewhere it is taken from the current request.
export async function fetchMe(token: string, clientIp?: string | null): Promise<MeResult> {
  const response = await callServer("/api/auth/v1/me", {
    headers: { authorization: `${SESSION_AUTH_SCHEME} ${token}` },
    timeoutMs: ME_TIMEOUT_MS,
    clientIp,
  });
  return toMeResult(response);
}
