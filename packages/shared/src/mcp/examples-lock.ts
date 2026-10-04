import type { LockResult } from "../locks.ts";
import type { McpToolExample } from "./definition.ts";
import { EXAMPLE_IDS } from "./examples-read.ts";

// Example calls of the lock tools for docs/mcp.md (see examples-read.ts).

const at = "2026-10-02T12:00:00.000Z";
const reason = "Release notes are final";

export const LOCK_EXAMPLES = {
  lock_note: {
    arguments: { note: EXAMPLE_IDS.other, reason },
    result: {
      kind: "note",
      id: EXAMPLE_IDS.other,
      path: "Projects/Release checklist",
      locked: {
        at,
        by: "docs-agent",
        reason,
        inherited: false,
        from: { kind: "note", id: EXAMPLE_IDS.other, path: "Projects/Release checklist" },
      },
      changed: true,
    } satisfies LockResult,
  },
  lock_folder: {
    arguments: { folder_id: EXAMPLE_IDS.archive, reason: "Archived; keep as it is" },
    result: {
      kind: "folder",
      id: EXAMPLE_IDS.archive,
      path: "Archive",
      locked: {
        at,
        by: "docs-agent",
        reason: "Archived; keep as it is",
        inherited: false,
        from: { kind: "folder", id: EXAMPLE_IDS.archive, path: "Archive" },
      },
      changed: true,
    } satisfies LockResult,
  },
} satisfies Record<string, McpToolExample>;
