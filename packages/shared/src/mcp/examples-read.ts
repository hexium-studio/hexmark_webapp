import type { ChangeEntry, SearchHit, TreeFolder, TreeResponse } from "../notes-responses.ts";
import type { McpToolExample } from "./definition.ts";

// Example calls of the tools for finding one's way, for docs/mcp.md: neutral
// data, typed with the response shapes so they cannot drift from what the
// server sends. Reading one note: examples-note.ts.

export const EXAMPLE_IDS = {
  projects: "3f2b8c1e-6d4a-4e7b-9a15-0c8d2e7f4b31",
  web: "8a1d5e90-2c7b-4f36-b4e8-71f9a3d6c205",
  archive: "c47e2a18-9b3d-4a5f-8e61-2d0b7f9c3a84",
  note: "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53",
  other: "e2b74c90-1a6d-4f8e-93c5-7b2d0e4f1a68",
  welcome: "91c3f6d8-5e2a-4b07-a8d9-3e6f1b5c7d20",
  private: "6b0e3d71-4c2a-4f9e-8d15-a7c3e9f2b046",
} as const;

// Where the depth ends: not loaded, counts only.
const webFolder: TreeFolder = {
  id: EXAMPLE_IDS.web,
  name: "Web",
  path: "Projects/Web",
  folderCount: 0,
  noteCount: 1,
  locked: null,
  hidden: null,
  loaded: false,
};

const tree: TreeResponse = {
  folder: null,
  folders: [
    // Hidden by a person: shown, but nothing of what lies below it.
    {
      id: EXAMPLE_IDS.private,
      name: "Private",
      path: "Private",
      folderCount: null,
      noteCount: null,
      locked: null,
      hidden: {
        at: "2026-10-02T12:00:00.000Z",
        by: "alex",
        reason: "Customer contracts",
        inherited: false,
        from: { kind: "folder", id: EXAMPLE_IDS.private, path: "Private" },
      },
      loaded: false,
    },
    {
      id: EXAMPLE_IDS.projects,
      name: "Projects",
      path: "Projects",
      folderCount: 1,
      noteCount: 1,
      locked: null,
      hidden: null,
      loaded: true,
      folders: [webFolder],
      notes: [
        {
          id: EXAMPLE_IDS.other,
          title: "Release checklist",
          version: 2,
          updatedAt: "2026-09-30T16:05:11.000Z",
          updatedBy: "alex",
          lastChange: "edited",
          locked: null,
          hidden: null,
        },
      ],
    },
  ],
  notes: [
    {
      id: EXAMPLE_IDS.welcome,
      title: "Welcome",
      version: 1,
      updatedAt: "2026-09-01T10:00:00.000Z",
      updatedBy: "alex",
      lastChange: "created",
      locked: null,
      hidden: null,
    },
  ],
};

const hit: SearchHit = {
  noteId: EXAMPLE_IDS.note,
  title: "Naming conventions",
  folderId: EXAMPLE_IDS.web,
  folderPath: "Projects/Web",
  sectionPath: "Naming conventions > Branches",
  heading: "Branches",
  snippet: "Use `feature/<topic>` and `fix/<topic>` in «kebab»-«case».",
  version: 4,
  rank: 1,
  hidden: null,
};

const change: ChangeEntry = {
  noteId: EXAMPLE_IDS.note,
  title: "Naming conventions",
  folderPath: "Projects/Web",
  version: 4,
  change: "edited",
  changes: 2,
  actorName: "docs-agent",
  reason: "Add branch naming rules",
  sectionPath: "Naming conventions > Branches",
  changedAt: "2026-10-01T09:30:00.000Z",
  deleted: false,
  locked: null,
  hidden: null,
};

const access = {
  kind: "token",
  actorName: "docs-agent",
  mode: "deny_list",
  permissions: ["read", "search", "create", "edit", "lock"],
  entries: null,
};

export const READ_EXAMPLES = {
  get_overview: {
    arguments: {},
    result: {
      instance: { name: "Hexmark" },
      access,
      tree,
      treeDepth: 2,
      counts: { notes: 3, folders: 3 },
    },
  },
  list_folder: {
    arguments: { folder_id: EXAMPLE_IDS.projects },
    result: {
      folder: {
        id: EXAMPLE_IDS.projects,
        name: "Projects",
        path: "Projects",
        locked: null,
        hidden: null,
      },
      folders: [webFolder],
      notes: [
        {
          id: EXAMPLE_IDS.other,
          title: "Release checklist",
          version: 2,
          updatedAt: "2026-09-30T16:05:11.000Z",
          updatedBy: "alex",
          lastChange: "edited",
          locked: null,
          hidden: null,
        },
      ],
    } satisfies TreeResponse,
  },
  search_notes: { arguments: { query: "kebab case", limit: 5 }, result: { hits: [hit] } },
  list_changes: { arguments: { since: "2026-10-01T00:00:00Z" }, result: { changes: [change] } },
} satisfies Record<string, McpToolExample>;
