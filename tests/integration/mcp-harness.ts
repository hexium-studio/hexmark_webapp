import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll } from "vitest";
import type { HexmarkServer } from "../support/hexmark-server";

// An MCP client (the official SDK) connected to the server's /mcp endpoint
// over Streamable HTTP with an API token, as an agent connects. Closed after
// the file.

const clients: Client[] = [];

afterAll(async () => {
  for (const client of clients.splice(0)) await client.close();
});

export async function connectMcp(server: HexmarkServer, token: string): Promise<Client> {
  const client = new Client({ name: "hexmark-tests", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

export interface ToolAnswer {
  isError: boolean;
  data: Record<string, unknown>;
}

// Calls a tool and parses its JSON text answer.
export async function tool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  const text = content.find((part) => part.type === "text")?.text ?? "{}";
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { text };
  }
  return { isError: result.isError === true, data };
}
