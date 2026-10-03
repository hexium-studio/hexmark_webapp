import { isIP } from "node:net";

// Security keys and passkeys (WebAuthn) as a second factor. Optional: they
// are offered only when PUBLIC_ORIGIN names the address users open Hexmark
// at, e.g. "https://wiki.example.com". Browsers allow WebAuthn only in a
// secure context, so the value must be https://, or http://localhost for
// local use. Its host name becomes the relying party ID (credentials are
// bound to it), the origin is what browser answers must come from.
//
// Without PUBLIC_ORIGIN, or with an invalid value (logged at start-up), the
// server does not offer security keys; authenticator apps work regardless.

export const PUBLIC_ORIGIN_ENV = "PUBLIC_ORIGIN";
export const WEBAUTHN_RP_NAME = "Hexmark";

export type WebauthnConfig =
  | { enabled: true; rpID: string; origin: string; rpName: string }
  | { enabled: false; problem?: string };

const LOCALHOST = /^(?:.+\.)?localhost$/;

// Pure: reads PUBLIC_ORIGIN from `source` without logging. `problem` is one
// sentence for the log and never contains the value.
export function readWebauthnConfig(source: NodeJS.ProcessEnv = process.env): WebauthnConfig {
  const raw = source[PUBLIC_ORIGIN_ENV]?.trim();
  if (!raw) return { enabled: false };
  const invalid = (reason: string): WebauthnConfig => ({
    enabled: false,
    problem: `${PUBLIC_ORIGIN_ENV} ${reason}; security keys and passkeys are not offered.`,
  });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid("is not a URL (expected e.g. https://wiki.example.com)");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return invalid("must be an origin only: scheme, host and optional port, no path");
  }
  // URL keeps IPv6 hosts in brackets; strip them for the check.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    return invalid("must use a host name; WebAuthn does not work with IP addresses");
  }
  const local = LOCALHOST.test(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return invalid("must start with https:// (http:// is allowed for localhost only)");
  }
  return { enabled: true, rpID: host, origin: url.origin, rpName: WEBAUTHN_RP_NAME };
}

let loaded: WebauthnConfig | undefined;

// The configuration of this process, read once.
export function webauthnConfig(): WebauthnConfig {
  loaded ??= readWebauthnConfig();
  return loaded;
}

// Start-up log (src/index.ts).
export function reportWebauthnConfig(): void {
  const config = webauthnConfig();
  if (!config.enabled && config.problem) console.error(`Configuration error: ${config.problem}`);
}
