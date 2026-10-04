// The MCP endpoint (src/mcp) and how clients reach it. One optional
// environment variable:
//
//   MCP_PUBLIC_URL  the address MCP clients use for this server's /mcp
//                   endpoint, e.g. https://wiki.example.com/mcp. Shown with a
//                   new API token. Without it the server cannot know which
//                   host clients see, and the web app derives the address
//                   from its own request host and SERVER_PORT.
//
// A malformed value is logged as a configuration error and treated as unset;
// the server always starts.

// Path of the endpoint on the API server.
export const MCP_PATH = "/mcp";

export interface McpUrlConfig {
  url: string | null;
  problem: string | null;
}

// Pure: reads the variable from `source` without logging. Accepts an absolute
// http(s) URL whose path ends in /mcp, without query or fragment; a trailing
// slash is dropped.
export function readMcpPublicUrl(source: NodeJS.ProcessEnv = process.env): McpUrlConfig {
  const raw = source.MCP_PUBLIC_URL?.trim();
  if (!raw) return { url: null, problem: null };
  const problem =
    "MCP_PUBLIC_URL must be an absolute http(s) URL ending in /mcp " +
    "(e.g. https://wiki.example.com/mcp); ignoring it.";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, problem };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const valid =
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    path.endsWith(MCP_PATH) &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.username === "" &&
    parsed.password === "";
  if (!valid) return { url: null, problem };
  return { url: `${parsed.origin}${path}`, problem: null };
}

const loaded = readMcpPublicUrl();

export const mcpPublicUrl = loaded.url;

// Called once at start-up (src/index.ts).
export function reportMcpConfig(): void {
  if (loaded.problem) console.error(`Configuration error: ${loaded.problem}`);
}

// Largest accepted MCP request body: a note body of 1 MB plus JSON-RPC framing.
export const MCP_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
