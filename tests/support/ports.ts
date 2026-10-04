import { connect, createServer, type Server, type Socket } from "node:net";

// Ports for the processes the tests start, and listeners the test process
// holds itself.
//
// Rule: every listener binds the wildcard address "::" (IPv6 and IPv4), so
// two processes on the same port always clash with EADDRINUSE. With different
// addresses (e.g. "::" and "127.0.0.1") macOS lets both bind and sends local
// IPv4 traffic to the more specific one: a silent mix-up instead of an error.
// A port is best chosen by the operating system (port 0) while binding; it
// never hands out a port that is in use on any address.

export const LISTEN_HOST = "::";

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LISTEN_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("no port assigned"));
    });
  });
}

function close(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}

// A port the operating system just reported as free. It is free only at that
// moment: another process may take it before the caller binds it, so the
// caller must bind LISTEN_HOST and start again on EADDRINUSE (web-server.ts).
// Prefer a process that binds port 0 and reports its port (hexmark-server.ts).
export async function freePort(): Promise<number> {
  const server = createServer();
  server.unref();
  const port = await listen(server);
  await close(server, new Set());
  return port;
}

export interface Listener {
  port: number;
  url: string;
  close(): Promise<void>;
}

function tracked(onConnection: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  return { server, sockets };
}

// A port that refuses every connection (accepts and closes it at once) for as
// long as it is held, e.g. a database port where no database answers. Unlike
// a port that is merely free, nobody else can start listening there.
export async function deadEndPort(): Promise<Listener> {
  const { server, sockets } = tracked((socket) => socket.destroy());
  const port = await listen(server);
  return { port, url: `http://127.0.0.1:${port}`, close: () => close(server, sockets) };
}

export interface Forwarder extends Listener {
  // Sends new connections to another port from now on.
  setTarget(port: number): void;
}

// Forwards TCP connections to 127.0.0.1:<target>. Its own port stays the same
// while the target moves, so a process that restarts on a new port (port 0)
// stays reachable at one address (the e2e API server, e2e/fixtures.ts).
export async function startForwarder(target: number): Promise<Forwarder> {
  let current = target;
  const { server, sockets } = tracked((client) => {
    const upstream = connect(current, "127.0.0.1");
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", end);
    upstream.on("error", end);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const port = await listen(server);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    setTarget(next) {
      current = next;
    },
    close: () => close(server, sockets),
  };
}
