import { ALREADY_LOCKED_MESSAGE, MCP_TOOLS } from "@hexmark/shared/mcp";
import type { AccessRef } from "../services/access/access";
import { lockFolder, lockNote } from "../services/locks/lock-actions";
import { type ToolMessages, toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// Locking a note or a folder. There is no unlock tool: only people unlock
// (HTTP API, signed in). Name, title, description and input schema:
// @hexmark/shared/mcp.

// A lock tool meets locked only when a folder above holds a lock already
// (alreadyLocked): the item is locked with it.
const MESSAGES: ToolMessages = { locked: ALREADY_LOCKED_MESSAGE };

export function lockTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.lock_note, async (args) =>
      toolResult(
        await lockNote(ref, new Date(), { address: args.note }, { reason: args.reason }),
        undefined,
        MESSAGES,
      ),
    ),
    defineTool(MCP_TOOLS.lock_folder, async (args) =>
      toolResult(
        await lockFolder(ref, new Date(), args.folder_id, { reason: args.reason }),
        undefined,
        MESSAGES,
      ),
    ),
  ];
}
