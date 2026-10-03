import { isRecord } from "@/lib/api-fields";

// A "signed_in" answer of the API server, which every step that completes a
// sign-in returns (login, second factor, forced enrolment; contract:
// apps/server/src/api/auth/v1/index.ts). The token is for the session
// cookie only, never for the browser.

export interface IssuedSession {
  token: string;
  expiresAt: string;
  remember: boolean;
}

// `locale`: the account's saved locale as the API reported it (unchecked;
// it is kept only if the registry offers it).
export interface SignedIn {
  session: IssuedSession;
  locale?: string;
}

function readSession(body: Record<string, unknown>): IssuedSession | undefined {
  const session = body.session;
  if (!isRecord(session)) return undefined;
  const { token, expiresAt, remember } = session;
  if (typeof token !== "string" || typeof expiresAt !== "string") return undefined;
  if (typeof remember !== "boolean") return undefined;
  return { token, expiresAt, remember };
}

// Session and locale of the body, or undefined when it is not "signed_in".
export function readSignedIn(body: Record<string, unknown>): SignedIn | undefined {
  if (body.ok !== true || body.status !== "signed_in") return undefined;
  const session = readSession(body);
  if (!session) return undefined;
  const locale = isRecord(body.user) ? body.user.locale : undefined;
  return typeof locale === "string" ? { session, locale } : { session };
}
