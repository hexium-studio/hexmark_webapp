import type { FolderResult, NoteWriteResult } from "../notes-responses.ts";
import type { McpToolExample } from "./definition.ts";
import { EXAMPLE_IDS } from "./examples-read.ts";

// Example calls of the writing tools for docs/mcp.md (see examples-read.ts).

const NEW_NOTE_ID = "6b0e3d71-4f9a-4c28-8b5e-0d2a7c9f1e46";
const NEW_FOLDER_ID = "f15a8e2c-7d3b-4096-a1e4-9c6b2d8f0a73";

function written(id: string, version: number, updatedAt: string, path: string): NoteWriteResult {
  const folderPath = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
  return { id, version, changed: true, updatedAt, folderPath, path, warnings: [] };
}

const folder: FolderResult = {
  id: NEW_FOLDER_ID,
  name: "Runbooks",
  parentId: EXAMPLE_IDS.projects,
  parentOutsideScope: false,
  path: "Projects/Runbooks",
};

export const WRITE_EXAMPLES = {
  create_note: {
    arguments: {
      folder_id: EXAMPLE_IDS.web,
      title: "Deployment",
      body: "# Deployment\n\n## Staging\n\nPush to `dev`; the pipeline deploys to staging.example.com.\n",
      reason: "Document the staging deployment",
    },
    result: written(NEW_NOTE_ID, 1, "2026-10-02T11:20:05.000Z", "Projects/Web/Deployment"),
  },
  update_note: {
    arguments: {
      note: EXAMPLE_IDS.note,
      expected_version: 4,
      title: "Naming rules",
      reason: "Shorter title",
    },
    result: written(EXAMPLE_IDS.note, 5, "2026-10-02T11:24:47.000Z", "Projects/Web/Naming rules"),
  },
  replace_section: {
    arguments: {
      note: "Projects/Web/Naming conventions",
      expected_version: 4,
      section: "Naming conventions > Branches",
      body: "## Branches\n\nUse `feature/<topic>`, `fix/<topic>` and `docs/<topic>` in kebab-case.\n",
      reason: "Add the docs/ prefix",
    },
    result: written(
      EXAMPLE_IDS.note,
      5,
      "2026-10-02T11:31:12.000Z",
      "Projects/Web/Naming conventions",
    ),
  },
  move_note: {
    arguments: {
      note: EXAMPLE_IDS.other,
      expected_version: 2,
      folder_id: NEW_FOLDER_ID,
      reason: "Checklists live in Runbooks",
    },
    result: written(
      EXAMPLE_IDS.other,
      3,
      "2026-10-02T11:40:58.000Z",
      "Projects/Runbooks/Release checklist",
    ),
  },
  create_folder: {
    arguments: {
      parent_id: EXAMPLE_IDS.projects,
      name: "Runbooks",
      reason: "Collect the operating guides",
    },
    result: folder,
  },
  rename_folder: {
    arguments: { folder_id: NEW_FOLDER_ID, name: "Playbooks", reason: "Match the team's wording" },
    result: { ...folder, name: "Playbooks", path: "Projects/Playbooks" },
  },
  move_folder: {
    arguments: {
      folder_id: NEW_FOLDER_ID,
      parent_id: EXAMPLE_IDS.web,
      reason: "Runbooks belong to the web project",
    },
    result: { ...folder, parentId: EXAMPLE_IDS.web, path: "Projects/Web/Runbooks" },
  },
} satisfies Record<string, McpToolExample>;
