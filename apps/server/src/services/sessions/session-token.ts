import { SESSION_AUTH_SCHEME, SESSION_TOKEN_PATTERN } from "@hexmark/shared";
import { SESSION_TOKEN_BYTES } from "../../config/session";
import {
  hashOpaqueToken,
  newOpaqueToken,
  type OpaqueToken,
  readBearerToken,
} from "../../lib/opaque-token";

// Session tokens: random values handed to the web server once; the database
// keeps only their digest (src/lib/opaque-token.ts).

export type NewSessionToken = OpaqueToken;

export function hashSessionToken(token: string): string {
  return hashOpaqueToken(token);
}

export function newSessionToken(): NewSessionToken {
  return newOpaqueToken(SESSION_TOKEN_BYTES);
}

// The token from an `Authorization: Session <token>` header; null when the
// header is missing, uses another scheme or the value is not a token.
export function readSessionToken(header: string | undefined): string | null {
  return readBearerToken(header, SESSION_AUTH_SCHEME, SESSION_TOKEN_PATTERN);
}
