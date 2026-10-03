// Server-to-server calls from the Next.js server to the Hexmark API server.
// Only import this from server code (server components, server actions): the
// browser never talks to the API server directly.

// Compose sets SERVER_INTERNAL_URL (http://server:3001); `pnpm dev` runs the
// API server on its default port.
const DEFAULT_SERVER_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 5_000;

export type ServerResponse =
  | { reachable: true; status: number; body: unknown }
  // No HTTP answer at all: connection refused, DNS failure or timeout.
  | { reachable: false };

export interface ServerRequest {
  method?: "GET" | "POST";
  // Sent as JSON.
  body?: unknown;
  timeoutMs?: number;
}

function serverBaseUrl(): string {
  return process.env.SERVER_INTERNAL_URL?.trim() || DEFAULT_SERVER_URL;
}

// Never throws: network failures are reported as { reachable: false } so a
// page can still render and explain the problem. A response without a JSON
// body yields body: null.
export async function callServer(
  path: string,
  request: ServerRequest = {},
): Promise<ServerResponse> {
  const { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = request;
  let response: Response;
  try {
    response = await fetch(new URL(path, serverBaseUrl()), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { reachable: false };
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { reachable: true, status: response.status, body: data };
}
