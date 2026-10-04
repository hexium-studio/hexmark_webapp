import { TRASH_LIST_LIMITS } from "@hexmark/shared";
import { MCP_TOOLS } from "@hexmark/shared/mcp";
import type { AccessRef } from "../services/access/access";
import { trashFolder } from "../services/trash/trash-folder";
import { listTrash } from "../services/trash/trash-list";
import { restoreNote, trashNote } from "../services/trash/trash-note";
import { restoreFolder } from "../services/trash/trash-restore-folder";
import { type ToolMessages, toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// The trash: deleting moves notes and folders there, listing and restoring
// bring them back. There is deliberately no tool that deletes for good: the
// services refuse API tokens that (services/trash/trash-delete.ts), and only
// the purge removes what agents deleted.
// Name, title, description and input schema: @hexmark/shared/mcp.

// A restored note keeps its title unless restore_note names another one.
const RESTORE_MESSAGES: ToolMessages = {
  title_taken:
    "A note in that folder has this title now (existingNoteId, path). Restore with another " +
    "title (title) or into another folder (folder_id).",
};

export function trashTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.delete_note, async (args) =>
      toolResult(
        await trashNote(
          ref,
          new Date(),
          { address: args.note },
          { expectedVersion: args.expected_version, reason: args.reason },
        ),
      ),
    ),

    defineTool(MCP_TOOLS.delete_folder, async (args) =>
      toolResult(await trashFolder(ref, new Date(), args.folder_id, { reason: args.reason })),
    ),

    defineTool(MCP_TOOLS.list_trash, async (args) =>
      toolResult(
        await listTrash(ref, new Date(), {
          folderId: args.folder_id ?? null,
          limit: args.limit ?? TRASH_LIST_LIMITS.default,
        }),
      ),
    ),

    defineTool(MCP_TOOLS.restore_note, async (args) =>
      toolResult(
        await restoreNote(ref, new Date(), args.note_id, {
          folderId: args.folder_id,
          title: args.title,
          reason: args.reason,
        }),
        undefined,
        RESTORE_MESSAGES,
      ),
    ),

    defineTool(MCP_TOOLS.restore_folder, async (args) =>
      toolResult(await restoreFolder(ref, new Date(), args.folder_id, { reason: args.reason })),
    ),
  ];
}
