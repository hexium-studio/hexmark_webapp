import {
  API_TOKEN_PATTERN,
  API_TOKEN_PREFIX,
  API_TOKEN_SHOWN_PREFIX_LENGTH,
  BEARER_AUTH_SCHEME,
} from "@hexmark/shared";
import { hashOpaqueToken, newOpaqueToken, readBearerToken } from "../../lib/opaque-token";

// API tokens: "hmk_" + 32 random bytes as base64url. The database keeps the
// SHA-256 digest (lower-case hex) and the first eight characters for
// recognising the token in a list (src/lib/opaque-token.ts).

const TOKEN_BYTES = 32;

export interface NewApiToken {
  token: string;
  hash: string;
  prefix: string;
}

export function hashApiToken(token: string): string {
  return hashOpaqueToken(token);
}

export function newApiToken(): NewApiToken {
  const token = `${API_TOKEN_PREFIX}${newOpaqueToken(TOKEN_BYTES).token}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, API_TOKEN_SHOWN_PREFIX_LENGTH),
  };
}

// The token from an `Authorization: Bearer <token>` header; null when the
// header is missing, uses another scheme or the value is not an API token.
export function readApiToken(header: string | undefined): string | null {
  return readBearerToken(header, BEARER_AUTH_SCHEME, API_TOKEN_PATTERN);
}
