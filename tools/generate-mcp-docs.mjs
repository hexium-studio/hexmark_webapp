#!/usr/bin/env node
// Writes the tool reference of docs/mcp.md from the MCP tool definitions
// (packages/shared/src/mcp), the same definitions the server registers.
//
//   node tools/generate-mcp-docs.mjs           rewrite the generated block
//                                              (`pnpm docs:mcp`)
//   node tools/generate-mcp-docs.mjs --check   exit 1 when docs/mcp.md is out
//                                              of date (`pnpm check:docs`)
//
// Only the text between the BEGIN/END GENERATED markers is touched. The
// tools are registered on an in-memory McpServer of the MCP SDK and read back
// with tools/list, so parameters and descriptions are exactly what a
// connecting agent sees. Also checked: every example's arguments pass the
// tool's input schema, and every error code a tool names appears in the
// hand-written Errors section.
//
// Plain Node, no build step: packages/shared is loaded as TypeScript through
// Node's type stripping.

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_COMMON_ERRORS, MCP_TOOLS, mcpToolConfig } from "../packages/shared/src/mcp/index.ts";
import { renderToolReference } from "./mcp-docs/render.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const docPath = fileURLToPath(new URL("../docs/mcp.md", import.meta.url));
const BEGIN = "<!-- BEGIN GENERATED: mcp-tools -->";
const END = "<!-- END GENERATED: mcp-tools -->";

function fail(message) {
  console.error(`generate-mcp-docs: ${message}`);
  process.exit(1);
}

// The tools as tools/list announces them.
async function listTools(definitions) {
  const server = new McpServer({ name: "hexmark-docs", version: "0.0.0" });
  for (const definition of definitions) {
    server.registerTool(definition.name, mcpToolConfig(definition), async () => ({
      content: [],
    }));
  }
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hexmark-docs", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

function checkExample(definition) {
  const { arguments: args } = definition.example;
  for (const name of Object.keys(args)) {
    if (!(name in definition.input)) fail(`${definition.name}: example has unknown "${name}"`);
  }
  for (const [name, schema] of Object.entries(definition.input)) {
    const parsed = schema.safeParse(args[name]);
    if (!parsed.success) {
      fail(`${definition.name}: example argument "${name}" is invalid: ${parsed.error.message}`);
    }
  }
}

function checkErrorsDocumented(definitions, handWritten) {
  const codes = new Set(MCP_COMMON_ERRORS.map(([code]) => code));
  for (const definition of definitions) for (const [code] of definition.errors) codes.add(code);
  const missing = [...codes].filter((code) => !handWritten.includes(`| \`${code}\` |`));
  if (missing.length > 0) {
    fail(`docs/mcp.md: the Errors table lacks ${missing.map((code) => `"${code}"`).join(", ")}`);
  }
}

const check = process.argv.includes("--check");
const definitions = Object.values(MCP_TOOLS);
const current = readFileSync(docPath, "utf8");
const start = current.indexOf(BEGIN);
const end = current.indexOf(END);
if (start < 0 || end < start) fail(`docs/mcp.md needs the markers ${BEGIN} and ${END}`);
const before = current.slice(0, start);
const after = current.slice(end + END.length);

definitions.forEach(checkExample);
checkErrorsDocumented(definitions, before + after);

const reference = renderToolReference(definitions, await listTools(definitions), MCP_COMMON_ERRORS);
const next = `${before}${BEGIN}\n\n${reference}\n\n${END}${after}`;
const shown = relative(repoRoot, docPath);

if (check) {
  if (next !== current) {
    fail(`${shown} is out of date with the MCP tool definitions; run \`pnpm docs:mcp\`.`);
  }
  console.log(`${shown} is up to date (${definitions.length} tools).`);
} else if (next === current) {
  console.log(`${shown} was already up to date (${definitions.length} tools).`);
} else {
  writeFileSync(docPath, next);
  console.log(`${shown}: tool reference rewritten (${definitions.length} tools).`);
}
