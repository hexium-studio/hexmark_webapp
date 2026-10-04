import { MCP_TOOLS } from "@hexmark/shared/mcp";
import type { AccessRef } from "../services/access/access";
import { createFolder, moveFolder, renameFolder } from "../services/notes/folders";
import { createNote } from "../services/notes/note-create";
import { replaceSection, updateNote } from "../services/notes/note-edits";
import { moveNote } from "../services/notes/note-moves";
import { toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// Tools that change the wiki. Every change of an existing note states the
// version it is based on; a newer version is a version_conflict.
// Name, title, description and input schema: @hexmark/shared/mcp.

export function writeTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.create_note, async (args) =>
      toolResult(
        await createNote(ref, new Date(), {
          folderId: args.folder_id ?? null,
          title: args.title,
          body: args.body,
          reason: args.reason,
        }),
      ),
    ),

    defineTool(MCP_TOOLS.update_note, async (args) =>
      toolResult(
        await updateNote(
          ref,
          new Date(),
          { address: args.note },
          {
            expectedVersion: args.expected_version,
            title: args.title,
            body: args.body,
            reason: args.reason,
          },
        ),
      ),
    ),

    defineTool(MCP_TOOLS.replace_section, async (args) =>
      toolResult(
        await replaceSection(
          ref,
          new Date(),
          { address: args.note },
          {
            expectedVersion: args.expected_version,
            section: args.section,
            body: args.body,
            includeSubsections: args.include_subsections ?? true,
            reason: args.reason,
          },
        ),
      ),
    ),

    defineTool(MCP_TOOLS.move_note, async (args) =>
      toolResult(
        await moveNote(
          ref,
          new Date(),
          { address: args.note },
          { expectedVersion: args.expected_version, folderId: args.folder_id, reason: args.reason },
        ),
      ),
    ),

    defineTool(MCP_TOOLS.create_folder, async (args) =>
      toolResult(
        await createFolder(ref, new Date(), {
          parentId: args.parent_id ?? null,
          name: args.name,
          reason: args.reason,
        }),
      ),
    ),

    defineTool(MCP_TOOLS.rename_folder, async (args) =>
      toolResult(
        await renameFolder(ref, new Date(), args.folder_id, {
          name: args.name,
          reason: args.reason,
        }),
      ),
    ),

    defineTool(MCP_TOOLS.move_folder, async (args) =>
      toolResult(
        await moveFolder(ref, new Date(), args.folder_id, {
          parentId: args.parent_id,
          reason: args.reason,
        }),
      ),
    ),
  ];
}
