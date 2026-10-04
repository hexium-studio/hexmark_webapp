// The MCP address shown with a new API token when the API server has no
// MCP_PUBLIC_URL (docs/mcp.md): the host the browser used for this page,
// the API server's published port and /mcp. HTTPS only when the browser
// reached us over HTTPS, which is known only from a trusted proxy
// (client-origin/resolve.ts). Pure, for unit tests.

export const DEFAULT_SERVER_PORT = 3001;
const MCP_PATH = "/mcp";

// SERVER_PORT as compose passes it; anything that is not a port falls back
// to the default the server listens on.
export function serverPort(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (!/^\d{1,5}$/.test(value)) return DEFAULT_SERVER_PORT;
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : DEFAULT_SERVER_PORT;
}

// `host`: the Host header ("wiki.example.com:3000", "[::1]:3000"). Undefined
// when it is missing or not a plain host name with an optional port.
export function deriveMcpUrl(
  host: string | null | undefined,
  secure: boolean,
  port: number,
): string | undefined {
  const value = host?.trim();
  if (!value || /[/?#@\s\\]/.test(value)) return undefined;
  let hostname: string;
  try {
    hostname = new URL(`http://${value}`).hostname;
  } catch {
    return undefined;
  }
  if (!hostname) return undefined;
  return `${secure ? "https" : "http"}://${hostname}:${port}${MCP_PATH}`;
}
