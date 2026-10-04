import type { HideResult } from "../hidden.ts";
import type { McpToolExample } from "./definition.ts";
import { EXAMPLE_IDS } from "./examples-read.ts";

// Example calls of the hide tools for docs/mcp.md (see examples-read.ts).

const at = "2026-10-02T12:00:00.000Z";

export const HIDE_EXAMPLES = {
  hide_note: {
    arguments: { note: EXAMPLE_IDS.other, reason: "Contains customer names" },
    result: {
      kind: "note",
      id: EXAMPLE_IDS.other,
      path: "Projects/Release checklist",
      hidden: {
        at,
        by: "docs-agent",
        reason: "Contains customer names",
        inherited: false,
        from: { kind: "note", id: EXAMPLE_IDS.other, path: "Projects/Release checklist" },
      },
      changed: true,
    } satisfies HideResult,
  },
  hide_folder: {
    arguments: { folder_id: EXAMPLE_IDS.private, reason: "Customer contracts" },
    result: {
      kind: "folder",
      id: EXAMPLE_IDS.private,
      path: "Private",
      hidden: {
        at,
        by: "docs-agent",
        reason: "Customer contracts",
        inherited: false,
        from: { kind: "folder", id: EXAMPLE_IDS.private, path: "Private" },
      },
      changed: true,
    } satisfies HideResult,
  },
} satisfies Record<string, McpToolExample>;
