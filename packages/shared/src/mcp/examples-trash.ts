import type { NoteWriteResult } from "../notes-responses.ts";
import type {
  RestoredFolder,
  TrashedFolder,
  TrashedNote,
  TrashListing,
} from "../trash-responses.ts";
import type { McpToolExample } from "./definition.ts";
import { EXAMPLE_IDS } from "./examples-read.ts";

// Example calls of the trash tools for docs/mcp.md (see examples-read.ts).

const BATCH_NOTE = "0b7d4e12-93a5-4c6f-8e21-5f9a3c7d1b84";
const BATCH_FOLDER = "a3e81c5f-27d9-4b60-9f14-6c0e8b2d7a39";

const trashedNote: TrashedNote = {
  kind: "note",
  id: EXAMPLE_IDS.other,
  version: 3,
  path: "Projects/Release checklist",
  deletedAt: "2026-10-02T12:00:00.000Z",
  purgeAt: "2026-10-30T12:00:00.000Z",
  batchId: BATCH_NOTE,
};

const trashedFolder: TrashedFolder = {
  kind: "folder",
  id: EXAMPLE_IDS.archive,
  path: "Projects/Archive",
  deletedAt: "2026-10-02T12:05:00.000Z",
  purgeAt: "2026-10-30T12:05:00.000Z",
  batchId: BATCH_FOLDER,
  folderCount: 1,
  noteCount: 4,
};

const listing: TrashListing = {
  retentionDays: 28,
  entries: [
    {
      kind: "folder",
      id: EXAMPLE_IDS.archive,
      name: "Archive",
      path: "Projects/Archive",
      parentId: EXAMPLE_IDS.projects,
      parentPath: "Projects",
      deletedAt: trashedFolder.deletedAt,
      deletedBy: "docs-agent",
      purgeAt: trashedFolder.purgeAt,
      batchId: BATCH_FOLDER,
      folderCount: 1,
      noteCount: 4,
    },
    {
      kind: "note",
      id: EXAMPLE_IDS.other,
      name: "Release checklist",
      path: "Projects/Release checklist",
      parentId: EXAMPLE_IDS.projects,
      parentPath: "Projects",
      deletedAt: trashedNote.deletedAt,
      deletedBy: "alex",
      purgeAt: trashedNote.purgeAt,
      batchId: BATCH_NOTE,
      version: 3,
    },
  ],
  hasMore: false,
};

const restoredNote: NoteWriteResult = {
  id: EXAMPLE_IDS.other,
  version: 4,
  changed: true,
  updatedAt: "2026-10-03T08:15:00.000Z",
  folderPath: "Projects",
  path: "Projects/Release checklist",
  warnings: [],
};

const restoredFolder: RestoredFolder = {
  id: EXAMPLE_IDS.archive,
  name: "Archive",
  path: "Projects/Archive",
  batchId: BATCH_FOLDER,
  restoredSubfolders: 1,
  restoredNotes: 4,
};

export const TRASH_EXAMPLES = {
  delete_note: {
    arguments: {
      note: EXAMPLE_IDS.other,
      expected_version: 2,
      reason: "Replaced by the release runbook",
    },
    result: trashedNote,
  },
  delete_folder: {
    arguments: { folder_id: EXAMPLE_IDS.archive, reason: "Old material, no longer needed" },
    result: trashedFolder,
  },
  list_trash: { arguments: { limit: 20 }, result: listing },
  restore_note: {
    arguments: { note_id: EXAMPLE_IDS.other, reason: "Still needed for the next release" },
    result: restoredNote,
  },
  restore_folder: {
    arguments: { folder_id: EXAMPLE_IDS.archive, reason: "Deleted by mistake" },
    result: restoredFolder,
  },
} satisfies Record<string, McpToolExample>;
