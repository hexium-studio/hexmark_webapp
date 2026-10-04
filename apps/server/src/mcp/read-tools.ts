import { CHANGES_LIMITS, SEARCH_LIMITS, TREE_DEPTH_LIMITS } from "@hexmark/shared";
import { MCP_TOOLS } from "@hexmark/shared/mcp";
import type { AccessRef } from "../services/access/access";
import { listChanges } from "../services/notes/history";
import { readOverview } from "../services/notes/overview";
import { searchNotes } from "../services/notes/search";
import { listTree } from "../services/notes/tree";
import { toolResult } from "./results";
import { defineTool, type RegisteredTool } from "./tool-registry";

// Tools for finding one's way: overview, folder listing, search, changes.
// Each calls the same service as the HTTP API, which checks the permission.
// Name, title, description and input schema: @hexmark/shared/mcp.

export function readTools(ref: AccessRef): RegisteredTool[] {
  return [
    defineTool(MCP_TOOLS.get_overview, async () => toolResult(await readOverview(ref, new Date()))),

    defineTool(MCP_TOOLS.list_folder, async (args) =>
      toolResult(
        await listTree(ref, new Date(), {
          folderId: args.folder_id ?? null,
          depth: args.depth ?? TREE_DEPTH_LIMITS.default,
        }),
      ),
    ),

    defineTool(MCP_TOOLS.search_notes, async (args) =>
      toolResult(
        await searchNotes(ref, new Date(), {
          query: args.query,
          folderId: args.folder_id ?? null,
          limit: args.limit ?? SEARCH_LIMITS.default,
        }),
        (hits) => ({ hits }),
      ),
    ),

    defineTool(MCP_TOOLS.list_changes, async (args) =>
      toolResult(
        await listChanges(ref, new Date(), {
          since: new Date(args.since),
          limit: args.limit ?? CHANGES_LIMITS.default,
        }),
        (changes) => ({ changes }),
      ),
    ),
  ];
}
