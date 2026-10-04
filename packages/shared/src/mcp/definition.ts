import type { NoteErrorCode } from "../note-errors.ts";
import type { NotePermission } from "../notes.ts";

// One MCP tool as the server registers it and docs/mcp.md documents it. The
// server takes title, description, input and annotations from here
// (mcpToolConfig); the generator (tools/generate-mcp-docs.mjs) renders the
// rest: permission, defaults, result fields, errors and the example.

// invalid_input: arguments that break a rule (the HTTP API's "validation"),
// with a rule per field.
export type McpErrorCode = NoteErrorCode | "invalid_input";

// [field, type, meaning]; nested fields are written "note.version", list
// items "hits[].snippet".
export type McpResultField = readonly [string, string, string];

// [code, when the tool answers with it].
export type McpToolError = readonly [McpErrorCode, string];

export interface McpToolExample {
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface McpToolDefinition<Input> {
  name: string;
  title: string;
  permission: NotePermission;
  readOnly: boolean;
  // Removes something from use (into the trash): announced as destructive,
  // although the trash can give it back.
  destructive?: boolean;
  description: string;
  input: Input;
  // Values an optional parameter takes when left out.
  defaults: Record<string, unknown>;
  result: readonly McpResultField[];
  // Errors of this tool besides the common ones (MCP_COMMON_ERRORS).
  errors: readonly McpToolError[];
  example: McpToolExample;
}

// Errors any tool can answer with, whatever it does.
export const MCP_COMMON_ERRORS: readonly McpToolError[] = [
  [
    "invalid_input",
    "An argument breaks its rule (missing, empty, wrong type, too long, bad format); " +
      "fields.<name> has code, params and rule.",
  ],
  ["forbidden", "The token lacks the tool's permission (details: permission)."],
  ["token_revoked", "The token was revoked while the agent was connected."],
  ["token_expired", "The token expired while the agent was connected."],
  ["setup_token_present", "The server's SETUP_TOKEN is still set; no token works."],
  ["database_unavailable", "The database cannot be reached."],
  ["server_not_configured", "The server is missing a required setting."],
];

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETES = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

// What McpServer.registerTool takes for a tool.
export function mcpToolConfig<Input>(tool: McpToolDefinition<Input>) {
  return {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.input,
    annotations: tool.readOnly ? READ_ONLY : tool.destructive ? DELETES : WRITES,
  };
}
