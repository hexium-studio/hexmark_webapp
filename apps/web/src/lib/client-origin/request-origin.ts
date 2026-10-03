import { PEER_ADDRESS_HEADER, peerAddressHookInstalled } from "./peer-address-hook";
import { type ClientOrigin, resolveClientOrigin } from "./resolve";
import { trustConfig } from "./trusted-proxies";

// The client origin of an incoming request, from its headers. The one place
// that decides it: the request proxy (src/proxy.ts), server components and
// server actions all call this, for the session cookie's Secure flag and
// for the address forwarded to the API server (src/lib/server-api.ts).

interface HeaderSource {
  get(name: string): string | null;
}

let missingHookReported = false;

export function requestOrigin(headers: HeaderSource): ClientOrigin {
  if (!peerAddressHookInstalled()) {
    // The peer header could be the client's own: trust nothing. The API
    // server then sees all users as the web server's address.
    if (!missingHookReported) {
      missingHookReported = true;
      console.error(
        "Client addresses are unknown: the peer address hook is not installed " +
          "(src/instrumentation.ts did not run in this process).",
      );
    }
    return { ip: undefined, secure: false };
  }
  const rules = trustConfig();
  return resolveClientOrigin(
    {
      peer: headers.get(PEER_ADDRESS_HEADER) ?? undefined,
      forwardedFor: headers.get("x-forwarded-for"),
      forwardedProto: headers.get("x-forwarded-proto"),
      clientHeader: rules.clientHeader ? headers.get(rules.clientHeader) : null,
    },
    rules,
  );
}
