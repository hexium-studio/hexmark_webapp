import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

// Next.js gives application code no access to the TCP connection of a
// request: NextRequest has no `ip` any more, and the X-Forwarded-For header
// that Next.js fills from the socket is kept as sent when the browser sends
// one itself, so it can be forged. This hook closes that gap with Node's own
// "http.server.request.start" diagnostics channel, which fires for every
// request of every HTTP server in this process before the request listener
// runs: it writes the socket's address into PEER_ADDRESS_HEADER, replacing
// whatever the client sent under that name. Next.js copies the request
// headers afterwards, so the proxy, server components and server actions
// all see the real peer address. Installed once at start-up
// (src/instrumentation.ts), for `next start`, `next dev` and the standalone
// server alike.

export const PEER_ADDRESS_HEADER = "x-hexmark-peer-address";

const INSTALLED = Symbol.for("hexmark.peerAddressHook");

interface RequestStart {
  request: IncomingMessage;
  socket: Socket;
}

type Marked = typeof globalThis & { [INSTALLED]?: boolean };

export function installPeerAddressHook(): void {
  const scope = globalThis as Marked;
  if (scope[INSTALLED]) return;
  subscribe("http.server.request.start", (message) => {
    const { request, socket } = message as RequestStart;
    const address = socket.remoteAddress;
    if (address) request.headers[PEER_ADDRESS_HEADER] = address;
    else delete request.headers[PEER_ADDRESS_HEADER];
  });
  scope[INSTALLED] = true;
}

// Without the hook, PEER_ADDRESS_HEADER would be whatever the client sent.
export function peerAddressHookInstalled(): boolean {
  return (globalThis as Marked)[INSTALLED] === true;
}
