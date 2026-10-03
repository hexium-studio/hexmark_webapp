import { normalizeIpAddress } from "@hexmark/shared/internal-calls";

// Which address a request comes from, and whether the browser used HTTPS.
// Pure: the inputs are header values, the trust rules come from
// trusted-proxies.ts.
//
// The peer is the machine connected to the web server. When it is not a
// trusted proxy, it is the client, and forwarding headers are ignored: anyone
// can send them. When it is a trusted proxy:
//   - with a configured client header (e.g. CF-Connecting-IP), that header's
//     address, if it holds one;
//   - else X-Forwarded-For, walked from the right (each proxy appends the
//     address it received the request from): trusted proxies are skipped, the
//     first untrusted address is the client. An entry that is not an address
//     stops the walk at the last proxy passed. If every entry is trusted, the
//     left-most one is the client.
//   - X-Forwarded-Proto: its last value, set by the trusted peer itself.

export interface TrustRules {
  isTrusted(address: string): boolean;
  // Lower-case header name, or null.
  clientHeader: string | null;
}

export interface OriginHeaders {
  // The connection's peer (peer-address-hook.ts); undefined when unknown.
  peer: string | undefined;
  forwardedFor: string | null;
  forwardedProto: string | null;
  // Value of TrustRules.clientHeader, if configured.
  clientHeader: string | null;
}

export interface ClientOrigin {
  // Canonical IP address; undefined when the peer is unknown.
  ip: string | undefined;
  // The browser connected over HTTPS (to a trusted proxy).
  secure: boolean;
}

export function walkForwardedFor(
  forwardedFor: string | null,
  peer: string,
  isTrusted: (address: string) => boolean,
): string {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  let nearest = peer;
  for (let index = hops.length - 1; index >= 0; index--) {
    const address = normalizeIpAddress(hops[index]);
    if (!address) return nearest;
    if (!isTrusted(address)) return address;
    nearest = address;
  }
  return nearest;
}

function lastValue(list: string | null): string | undefined {
  const values = (list ?? "").split(",").map((value) => value.trim());
  return values[values.length - 1]?.toLowerCase() || undefined;
}

export function resolveClientOrigin(headers: OriginHeaders, rules: TrustRules): ClientOrigin {
  const peer = normalizeIpAddress(headers.peer);
  if (!peer || !rules.isTrusted(peer)) return { ip: peer, secure: false };
  const secure = lastValue(headers.forwardedProto) === "https";
  if (rules.clientHeader) {
    const named = normalizeIpAddress(headers.clientHeader);
    if (named) return { ip: named, secure };
  }
  return { ip: walkForwardedFor(headers.forwardedFor, peer, rules.isTrusted), secure };
}
