import { MCP_TOOLS } from "@hexmark/shared/mcp";
import type { AccessRef } from "../services/access/access";
import { hideFolder, hideNote } from "../services/hidden/hide-actions";
import { toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// Hiding a note or a folder. There is no unhide tool: only people unhide
// (HTTP API, signed in). Name, title, description and input schema:
// @hexmark/shared/mcp.

export function hideTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.hide_note, async (args) =>
      toolResult(await hideNote(ref, new Date(), { address: args.note }, { reason: args.reason })),
    ),
    defineTool(MCP_TOOLS.hide_folder, async (args) =>
      toolResult(await hideFolder(ref, new Date(), args.folder_id, { reason: args.reason })),
    ),
  ];
}
