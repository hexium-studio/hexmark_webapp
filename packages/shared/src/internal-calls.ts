import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// Calls from the web server to the API server, and the instance keys from
// .env (Node.js only: the API server and the server side of the web app,
// never the browser).
//
// The web server forwards the browser's address in CLIENT_IP_HEADER. The API
// server believes it only when INTERNAL_KEY_HEADER carries INTERNAL_API_KEY,
// which both read from their environment.

export const CLIENT_IP_HEADER = "x-hexmark-client-ip";
export const INTERNAL_KEY_HEADER = "x-hexmark-internal-key";

export const INTERNAL_KEY_ENV = "INTERNAL_API_KEY";

// Format of INTERNAL_API_KEY and ENCRYPTION_KEY: 32 random bytes in
// base64url without padding, i.e. exactly 43 characters of A-Z, a-z, 0-9,
// "-" and "_". Generate one with
//   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
// or
//   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
export const INSTANCE_KEY_BYTES = 32;
const INSTANCE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// The 32 key bytes, or null for anything else (wrong length, other
// characters, or a non-canonical last character). Surrounding spaces are
// ignored. Never log the value.
export function parseInstanceKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim() ?? "";
  if (!INSTANCE_KEY_PATTERN.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  // 43 characters carry 258 bits; the last 2 must be zero, so every key has
  // exactly one spelling and both servers compare the same string.
  if (bytes.length !== INSTANCE_KEY_BYTES || bytes.toString("base64url") !== value) return null;
  return bytes;
}

export type InstanceKeyState = "missing" | "invalid" | "valid";

export function instanceKeyState(raw: string | undefined): InstanceKeyState {
  if (raw === undefined || raw.trim() === "") return "missing";
  return parseInstanceKey(raw) ? "valid" : "invalid";
}

// INTERNAL_API_KEY as sent in INTERNAL_KEY_HEADER, or null when it is not set
// or not valid.
export function readInternalKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source[INTERNAL_KEY_ENV];
  return parseInstanceKey(raw) ? (raw?.trim() ?? null) : null;
}

// Constant-time comparison of a presented key with the expected one. Both
// are hashed to equal length first, so neither the position of the first
// difference nor the length of the presented value shows in the timing.
export function internalKeyMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

// Longest accepted textual address: a full IPv6 address with an embedded
// IPv4 part, brackets and a port. Anything longer is not an address.
const MAX_ADDRESS_LENGTH = 64;

// The canonical form of an IP address, or undefined for anything else.
// Accepts the forms proxies put into X-Forwarded-For: "[v6]:port",
// "v4:port", surrounding spaces. IPv4-mapped IPv6 addresses
// (::ffff:192.0.2.1, as a dual-stack socket reports IPv4 peers) become plain
// IPv4, so one client always maps to one key. IPv6 is lower-cased; a zone
// index (%eth0) is dropped.
export function normalizeIpAddress(raw: string | null | undefined): string | undefined {
  let value = raw?.trim();
  if (!value || value.length > MAX_ADDRESS_LENGTH) return undefined;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed?.[1]) value = bracketed[1];
  else {
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
    if (v4WithPort?.[1]) value = v4WithPort[1];
  }
  value = value.split("%")[0] ?? "";
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return undefined;
  const lower = value.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1] && isIP(mapped[1]) === 4) return mapped[1];
  return lower;
}
