import { createHash, randomBytes } from "node:crypto";

// Random bearer tokens of which only a digest is stored: the client holds the
// token, the database its SHA-256 digest as lower-case hex (the format the
// tables check), so a leaked table hands out nothing usable. Used for
// sessions and for sign-in challenges. Tokens are never logged.

export interface OpaqueToken {
  token: string;
  hash: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// `bytes` random bytes as base64url without padding.
export function newOpaqueToken(bytes: number): OpaqueToken {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: hashOpaqueToken(token) };
}

// The token from an `Authorization: <scheme> <token>` header; null when the
// header is missing, uses another scheme or the value does not match
// `pattern`.
export function readBearerToken(
  header: string | undefined,
  scheme: string,
  pattern: RegExp,
): string | null {
  if (!header) return null;
  const match = new RegExp(`^${scheme}\\s+(\\S+)$`, "i").exec(header.trim());
  const token = match?.[1];
  return token && pattern.test(token) ? token : null;
}
