import {
  CLIENT_IP_HEADER,
  INTERNAL_KEY_HEADER,
  internalKeyMatches,
  normalizeIpAddress,
} from "@hexmark/shared/internal-calls";
import type { Context } from "hono";
import { instanceSecrets } from "../config/secrets";
import { socketAddress } from "../lib/client-address";

// The address a request is attributed to, e.g. for rate limits. Every
// endpoint that needs it calls this function; none reads the headers itself.
//
// Browsers reach this server through the web server, so the connection's
// source address is the web server's for every user. The web server sends
// the browser's address in X-Hexmark-Client-IP. That header is believed only
// when X-Hexmark-Internal-Key carries the instance's internal key
// (src/config/secrets.ts); anyone else who reaches the API port could set it.
// A missing or wrong key, or an address that does not parse, falls back to
// the connection's source address, without telling the caller why.

let mismatchReported = false;

export function clientAddress(c: Context): string {
  const socket = socketAddress(c);
  const forwarded = c.req.header(CLIENT_IP_HEADER);
  if (forwarded === undefined) return socket;
  const expected = instanceSecrets().internalApiKey;
  if (!expected || !internalKeyMatches(c.req.header(INTERNAL_KEY_HEADER), expected)) {
    if (!mismatchReported && c.req.header(INTERNAL_KEY_HEADER) !== undefined) {
      // Once per process: usually web and API server read different secrets.
      mismatchReported = true;
      console.warn(
        "Ignored a forwarded client address with a wrong internal key. If this is the web " +
          "server, it does not share the instance secrets with this server (docs/deployment.md).",
      );
    }
    return socket;
  }
  return normalizeIpAddress(forwarded) ?? socket;
}
