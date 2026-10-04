import { MCP_TOOLS } from "@hexmark/shared/mcp";
import { sectionTokenBudget } from "../config/notes";
import type { AccessRef } from "../services/access/access";
import { listRevisions, readRevision } from "../services/notes/history";
import { readFullNote, readOutline, readSection } from "../services/notes/note-reads";
import { toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// Tools for reading one note: outline, a section, the whole note, its
// revisions. Notes are addressed by id, title or folder path + title.
// Name, title, description and input schema: @hexmark/shared/mcp.

export function noteTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.read_outline, async (args) =>
      toolResult(await readOutline(ref, new Date(), { address: args.note })),
    ),

    defineTool(MCP_TOOLS.read_section, async (args) =>
      toolResult(
        await readSection(
          ref,
          new Date(),
          { address: args.note },
          {
            path: args.section,
            includeSubsections: args.include_subsections ?? true,
            offset: args.offset,
            limit: args.limit,
          },
        ),
      ),
    ),

    defineTool(MCP_TOOLS.read_note, async (args) =>
      toolResult(await readFullNote(ref, new Date(), { address: args.note }), (note) => ({
        note,
        ...(note.approxTokens > sectionTokenBudget
          ? {
              hint:
                `This note is about ${note.approxTokens} tokens. Next time use read_outline and ` +
                "read_section (with offset/limit for a section above the budget).",
            }
          : {}),
      })),
    ),

    defineTool(MCP_TOOLS.list_revisions, async (args) =>
      toolResult(await listRevisions(ref, new Date(), { address: args.note })),
    ),

    defineTool(MCP_TOOLS.read_revision, async (args) =>
      toolResult(await readRevision(ref, new Date(), { address: args.note }, args.version)),
    ),
  ];
}
