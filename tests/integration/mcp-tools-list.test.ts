import { MCP_TOOLS, mcpToolConfig } from "@hexmark/shared/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp } from "./mcp-harness";
import { apiToken, notesWorld, signedIn } from "./notes-api-harness";

// The running server's tools/list against MCP_TOOLS (@hexmark/shared/mcp),
// the definitions docs/mcp.md is generated from. The reference list is
// built the way the generator builds it (tools/generate-mcp-docs.mjs): every
// definition registered with mcpToolConfig on an in-memory McpServer. So a
// tool the server registers differently, adds or leaves out fails here,
// while `pnpm check:docs` keeps the document in line with the definitions.

const definitions = Object.values(MCP_TOOLS);

async function referenceTools(): Promise<Tool[]> {
  const server = new McpServer({ name: "hexmark-reference", version: "0.0.0" });
  for (const definition of definitions) {
    server.registerTool(definition.name, mcpToolConfig(definition), async () => ({
      content: [],
    }));
  }
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hexmark-reference", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  // As over HTTP: through JSON, which drops keys left undefined.
  return JSON.parse(JSON.stringify(tools)) as Tool[];
}

const byName = (tools: Tool[]) => new Map(tools.map((tool) => [tool.name, tool] as const));

let served: Tool[];
let reference: Tool[];

beforeAll(async () => {
  const world = await notesWorld();
  const { auth } = await signedIn(world, "ada");
  const token = await apiToken(world, auth, {
    name: "every-permission",
    permissions: ["read", "search", "create", "edit", "move", "delete", "lock"],
  });
  const client = await connectMcp(world.server, token.token);
  served = (await client.listTools()).tools;
  reference = await referenceTools();
});

describe("tools/list of the running server", () => {
  it("names exactly the tools of MCP_TOOLS, each under its own key", () => {
    const keys = Object.keys(MCP_TOOLS);
    expect(keys.length).toBeGreaterThan(0);
    for (const [key, definition] of Object.entries(MCP_TOOLS)) expect(definition.name).toBe(key);
    expect(served.map((tool) => tool.name).sort()).toEqual([...keys].sort());
  });

  it("announces each tool's title, description and annotations from its definition", () => {
    const tools = byName(served);
    for (const definition of definitions) {
      const tool = tools.get(definition.name);
      expect(tool, definition.name).toBeDefined();
      const config = mcpToolConfig(definition);
      expect(tool?.title, definition.name).toBe(config.title);
      expect(tool?.description, definition.name).toBe(definition.description);
      expect(tool?.annotations, definition.name).toEqual(config.annotations);
    }
  });

  it("announces the same input schemas as the definitions documented in docs/mcp.md", () => {
    expect(reference).toHaveLength(definitions.length);
    const expected = byName(reference);
    let properties = 0;
    for (const tool of served) {
      const documented = expected.get(tool.name);
      expect(documented, tool.name).toBeDefined();
      expect(tool.inputSchema, tool.name).toEqual(documented?.inputSchema);
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).toEqual(
        Object.keys(definitions.find((entry) => entry.name === tool.name)?.input ?? {}),
      );
      properties += Object.keys(tool.inputSchema.properties ?? {}).length;
    }
    // The comparison covered real schemas, not empty objects on both sides.
    expect(properties).toBeGreaterThan(definitions.length);
  });

  it("has the trash tools, the deleting ones announced as destructive, none deleting for good", () => {
    const tools = byName(served);
    expect(served).toHaveLength(21);
    for (const name of ["delete_note", "delete_folder"]) {
      expect(tools.get(name)?.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(tools.get(name)?.description, name).toContain(
        "Agents cannot delete anything for good",
      );
    }
    for (const name of ["restore_note", "restore_folder"]) {
      expect(tools.get(name)?.annotations, name).toMatchObject({ destructiveHint: false });
    }
    expect(tools.get("list_trash")?.annotations).toMatchObject({ readOnlyHint: true });
    const forGood = served.filter((tool) => /purge|permanent|empty|for_good/.test(tool.name));
    expect(forGood).toEqual([]);
  });

  it("has rename_folder (edit) and move_folder (move) as plain writes with a reason", () => {
    const tools = byName(served);
    for (const name of ["rename_folder", "move_folder"]) {
      expect(tools.get(name)?.annotations, name).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
    expect(MCP_TOOLS.rename_folder.permission).toBe("edit");
    expect(MCP_TOOLS.move_folder.permission).toBe("move");
    expect(Object.keys(tools.get("move_folder")?.inputSchema.properties ?? {})).toEqual([
      "folder_id",
      "parent_id",
      "reason",
    ]);
    expect(Object.keys(tools.get("rename_folder")?.inputSchema.properties ?? {})).toEqual([
      "folder_id",
      "name",
      "reason",
    ]);
    expect(tools.get("rename_folder")?.inputSchema.required).toEqual(["folder_id", "name"]);
    expect(tools.get("move_folder")?.inputSchema.required).toEqual(["folder_id", "parent_id"]);
  });

  it("matches the reference list entry for entry, with nothing added", () => {
    const sorted = (tools: Tool[]) => [...tools].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted(served)).toEqual(sorted(reference));
  });
});
