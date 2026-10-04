import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { MCP_BODY_LIMIT_BYTES } from "../config/mcp";
import { failureResponse } from "../lib/outcome";
import type { AccessRef } from "../services/access/access";
import { type AccessDescription, describeAccess } from "../services/access/describe";
import { requestAccess } from "../services/access/request-access";
import { GUIDE_URI, guideText, serverInstructions } from "./guide";
import { hideTools } from "./hide-tools";
import { lockTools } from "./lock-tools";
import { noteTools } from "./note-tools";
import { readTools } from "./read-tools";
import { ToolRegistry } from "./tool-registry";
import { trashTools } from "./trash-tools";
import { writeTools } from "./write-tools";

// The MCP server: Streamable HTTP at /mcp (mounted in src/index.ts), for
// agents with an API token (`Authorization: Bearer hmk_...`). Stateless:
// every POST is answered on its own by a server built for that request and
// its token, so revoking a token stops the very next request. The tools call
// the same services as /api/notes/v1, with the same permission checks.
//
// Built on the SDK's low-level Server rather than McpServer, so the tools
// check their own arguments (tool-registry.ts) and invalid ones get a
// Hexmark error; tools/list stays what McpServer would announce.
//
// POST /mcp   JSON-RPC (initialize, tools/list, tools/call, resources/read, ...)
// GET, DELETE /mcp   405: no server-initiated stream and no sessions
// 401 unauthenticated | token_revoked | token_expired; 403 setup_token_present;
// 503 database_unavailable | server_not_configured (JSON like the HTTP API)

const SERVER_INFO = { name: "hexmark", version: "1.0.0" };

const GUIDE = {
  uri: GUIDE_URI,
  name: "guide",
  title: "Hexmark guide",
  description: "How notes, folders, sections, addressing and versions work here.",
  mimeType: "text/markdown",
};

function buildServer(ref: AccessRef, access: AccessDescription): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
    instructions: serverInstructions(access),
  });
  const tools = new ToolRegistry(ref);
  tools.add(
    ...readTools(ref),
    ...noteTools(ref),
    ...writeTools(ref),
    ...trashTools(ref),
    ...lockTools(ref),
    ...hideTools(ref),
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.list() }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    tools.call(request.params.name, request.params.arguments),
  );
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [GUIDE] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: [] }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== GUIDE_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Resource ${request.params.uri} not found`);
    }
    return {
      contents: [{ uri: GUIDE_URI, mimeType: GUIDE.mimeType, text: guideText(access) }],
    };
  });
  return server;
}

export const mcp = new Hono();

mcp.post("/", async (c) => {
  const now = new Date();
  const ref = await requestAccess(c, now, { session: false, bearer: true, via: "mcp" });
  if (ref instanceof Response) return ref;
  const access = await describeAccess(ref, now);
  if (!access.ok) return failureResponse(c, access);
  const server = buildServer(ref, access.value);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_BODY_LIMIT_BYTES,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
});

const methodNotAllowed = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed: this server is stateless; use POST." },
  id: null,
};

mcp.get("/", (c) => c.json(methodNotAllowed, 405, { Allow: "POST" }));
mcp.delete("/", (c) => c.json(methodNotAllowed, 405, { Allow: "POST" }));
