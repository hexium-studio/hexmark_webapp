import { connect, createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { lineSplitter } from "../../support/lines";
import { deadEndPort, freePort, LISTEN_HOST, startForwarder } from "../../support/ports";

// Test support: ports for started processes (support/ports.ts) and reading
// their output line by line (support/lines.ts).

const open: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of open.splice(0).reverse()) await close();
});

// A server answering every connection with `reply`, on a port of its own.
async function replying(reply: string): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => socket.end(reply));
  await new Promise<void>((resolve) => server.listen(0, LISTEN_HOST, resolve));
  open.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0 };
}

async function fetchText(url: string): Promise<string> {
  return (await fetch(url)).text();
}

// Raw TCP: what arrives on a port before it is closed, or the error.
function read(port: number): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const socket = connect(port, "127.0.0.1");
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    socket.on("close", () => resolve(text));
    socket.on("error", (error: NodeJS.ErrnoException) => resolve(`error ${error.code}`));
  });
}

describe("ports", () => {
  it("clashes on the same port whatever local address the other binds", async () => {
    const { port } = await replying("first");
    for (const host of [LISTEN_HOST, "0.0.0.0"]) {
      const second = createServer();
      const error = await new Promise<string>((resolve) => {
        second.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? ""));
        second.listen(port, host, () => resolve("bound"));
      });
      second.close();
      expect(error, host).toBe("EADDRINUSE");
    }
  });

  it("reports a port that can be bound right away", async () => {
    const port = await freePort();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, LISTEN_HOST, resolve));
    open.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    expect(port).toBeGreaterThan(0);
  });

  it("holds a dead-end port that closes every connection", async () => {
    const dead = await deadEndPort();
    open.push(() => dead.close());
    expect(await read(dead.port)).toBe("");
    expect(await read(dead.port)).toBe("");
  });

  it("forwards to the current target and keeps its own port when the target moves", async () => {
    const a = await replying("from a");
    const b = await replying("from b");
    const forwarder = await startForwarder(a.port);
    open.push(() => forwarder.close());
    expect(await read(forwarder.port)).toBe("from a");
    forwarder.setTarget(b.port);
    expect(await read(forwarder.port)).toBe("from b");
    expect(forwarder.url).toBe(`http://127.0.0.1:${forwarder.port}`);
  });

  it("forwards HTTP both ways", async () => {
    const http = await import("node:http");
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => response.end(`${request.method} ${request.url} ${body}`));
    });
    await new Promise<void>((resolve) => server.listen(0, LISTEN_HOST, resolve));
    open.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    const forwarder = await startForwarder(
      typeof address === "object" && address ? address.port : 0,
    );
    open.push(() => forwarder.close());
    const response = await fetch(`${forwarder.url}/path?q=1`, { method: "POST", body: "hello" });
    expect(await response.text()).toBe("POST /path?q=1 hello");
    expect(await fetchText(`${forwarder.url}/again`)).toBe("GET /again ");
  });

  it("closes the connection when nothing listens at the target", async () => {
    const dead = await deadEndPort();
    const target = dead.port;
    await dead.close();
    const forwarder = await startForwarder(target);
    open.push(() => forwarder.close());
    expect(await read(forwarder.port)).toMatch(/^(|error ECONNRESET)$/);
  });
});

describe("lineSplitter", () => {
  it("returns whole lines and holds back a line cut between chunks", () => {
    const lines = lineSplitter();
    expect(lines.push(Buffer.from("one\ntw"))).toEqual(["one"]);
    expect(lines.push(Buffer.from("o\r\nthree"))).toEqual(["two"]);
    expect(lines.flush()).toEqual(["three"]);
    expect(lines.flush()).toEqual([]);
  });

  it("keeps a character cut between chunks", () => {
    const bytes = Buffer.from("port ä\n");
    const lines = lineSplitter();
    expect(lines.push(bytes.subarray(0, 6))).toEqual([]);
    expect(lines.push(bytes.subarray(6))).toEqual(["port ä"]);
  });
});
