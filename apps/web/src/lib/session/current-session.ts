import { cookies, headers } from "next/headers";
import { cache } from "react";
import { readSessionToken, SESSION_COOKIE_NAME } from "./cookie";
import { fetchMe } from "./me";
import {
  decodeSessionHeader,
  type ResolvedSession,
  SESSION_HEADER,
  tokenDigest,
} from "./session-header";

// The session of the current request, for server components: who is signed
// in, if anyone. Usually what the request proxy found (src/proxy.ts), read
// from its request header, so pages do not ask the API server again.
// Only server code may import this file.
//
// The header is outdated when a server action changed the cookie after the
// proxy ran: Next.js renders the page again in the same request after a
// sign-in or sign-out. The digest in the header then no longer matches the
// cookie, and the cookie wins: no token means signed out, a new token is
// checked with /me once.

export const currentSession = cache(async (): Promise<ResolvedSession> => {
  const jar = await cookies();
  const token = readSessionToken(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!token) return { state: "signed-out" };
  const header = decodeSessionHeader((await headers()).get(SESSION_HEADER));
  if (header && header.token === (await tokenDigest(token))) return header.session;

  const me = await fetchMe(token);
  if (me.kind === "invalid") return { state: "signed-out" };
  if (me.kind === "unavailable") return { state: "unavailable" };
  // A rotatedToken cannot come back here: the only token the proxy has not
  // seen is one a sign-in action issued moments ago, far from due for
  // rotation (pages cannot write cookies, so a rotation here would be lost).
  return { state: "signed-in", user: me.user };
});
