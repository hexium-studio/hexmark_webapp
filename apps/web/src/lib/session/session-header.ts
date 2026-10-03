import type { AuthUser } from "@hexmark/shared";
import { readAuthUser } from "./me";

// How the request proxy (src/proxy.ts) hands the session it resolved to the
// pages of the same request, so a page does not call /me a second time: as
// a request header the proxy sets on the request it passes on. Request
// headers set by the proxy never reach the browser.
//
// The proxy runs for every route that renders and always replaces this
// header, so a value sent by the browser never survives. The header also
// names the token it was resolved for (as a digest, never the token itself):
// when a server action changes the cookie later in the same request (sign-in,
// sign-out), the page sees that the header is outdated (current-session.ts).

export const SESSION_HEADER = "x-hexmark-session";

export type ResolvedSession =
  | { state: "signed-in"; user: AuthUser }
  | { state: "signed-out" }
  // A cookie is there, but the API server gave no usable answer.
  | { state: "unavailable" };

export interface SessionHeader {
  // Digest of the token in the cookie after the proxy ran; "" without one.
  token: string;
  session: ResolvedSession;
}

// SHA-256 of the token, hex. Web Crypto, so it runs wherever the proxy runs.
export async function tokenDigest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Base64url of the JSON: display names may hold any character, header values
// only ASCII.
export function encodeSessionHeader(header: SessionHeader): string {
  return Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
}

export function decodeSessionHeader(value: string | null): SessionHeader | undefined {
  if (!value) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const { token, session } = data as { token?: unknown; session?: unknown };
  if (typeof token !== "string" || typeof session !== "object" || session === null) {
    return undefined;
  }
  const { state, user } = session as { state?: unknown; user?: unknown };
  if (state === "signed-out" || state === "unavailable") return { token, session: { state } };
  const parsedUser = state === "signed-in" ? readAuthUser(user) : undefined;
  return parsedUser ? { token, session: { state: "signed-in", user: parsedUser } } : undefined;
}
