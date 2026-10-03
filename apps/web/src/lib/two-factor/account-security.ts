import type { AccountSecurityResponse } from "@hexmark/shared";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { readAccountSecurity } from "./overview";

// GET /api/account/v1/security for the signed-in user of the current
// request (home and the account security page). Server code only.

export type AccountSecurityResult =
  | { kind: "ok"; security: AccountSecurityResponse }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

export async function loadAccountSecurity(): Promise<AccountSecurityResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return { kind: "unauthenticated" };
  const response = await callServer("/api/account/v1/security", { headers: { authorization } });
  if (!response.reachable) return { kind: "unavailable" };
  if (response.status === 401) return { kind: "unauthenticated" };
  const security = response.status === 200 ? readAccountSecurity(response.body) : undefined;
  return security ? { kind: "ok", security } : { kind: "unavailable" };
}
