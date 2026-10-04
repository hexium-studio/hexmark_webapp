import type {
  FullNote,
  NoteHeader,
  OutlineSection,
  RevisionSnapshot,
  RevisionSummary,
  SectionText,
} from "../notes-responses.ts";
import type { McpToolExample } from "./definition.ts";
import { EXAMPLE_IDS } from "./examples-read.ts";

// Example calls of the tools that read one note, for docs/mcp.md (see
// examples-read.ts).

const header: NoteHeader = {
  id: EXAMPLE_IDS.note,
  title: "Naming conventions",
  folderId: EXAMPLE_IDS.web,
  folderPath: "Projects/Web",
  path: "Projects/Web/Naming conventions",
  version: 4,
  createdAt: "2026-09-14T08:12:40.000Z",
  createdBy: "alex",
  updatedAt: "2026-10-01T09:30:00.000Z",
  updatedBy: "docs-agent",
  locked: null,
  hidden: null,
};

function outlineEntry(
  position: number,
  heading: string,
  path: string,
  characters: number,
): OutlineSection {
  const level = position === 0 ? 1 : 2;
  const parentPosition = position === 0 ? null : 0;
  const approxTokens = Math.ceil(characters / 4);
  return {
    position,
    level,
    heading,
    path,
    parentPosition,
    characters,
    approxTokens,
    overBudget: false,
  };
}

const sections: OutlineSection[] = [
  outlineEntry(0, "Naming conventions", "Naming conventions", 2140),
  outlineEntry(1, "Files", "Naming conventions > Files", 820),
  outlineEntry(2, "Branches", "Naming conventions > Branches", 1190),
];

const sectionText: SectionText = {
  path: "Naming conventions > Branches",
  level: 2,
  heading: "Branches",
  includesSubsections: true,
  text: "## Branches\n\nUse `feature/<topic>` and `fix/<topic>` in kebab-case.\n",
  characters: 66,
  approxTokens: 17,
  offset: 0,
  returned: 66,
  total: 66,
  hasMore: false,
  nextOffset: null,
};

const fullNote: FullNote = {
  ...header,
  body: "# Naming conventions\n\nHow we name things.\n\n## Files\n\nkebab-case.\n",
  metadata: {},
  characters: 65,
  approxTokens: 17,
};

const revision: RevisionSummary = {
  version: 4,
  change: "edited",
  reason: "Add branch naming rules",
  actorName: "docs-agent",
  createdAt: "2026-10-01T09:30:00.000Z",
  title: "Naming conventions",
  folderId: EXAMPLE_IDS.web,
  folderPath: "Projects/Web",
  folderOutsideScope: false,
  sectionPath: "Naming conventions > Branches",
};

const snapshot: RevisionSnapshot = {
  noteId: EXAMPLE_IDS.note,
  version: 1,
  change: "created",
  reason: "First draft",
  actorName: "alex",
  createdAt: "2026-09-14T08:12:40.000Z",
  title: "Naming",
  folderId: EXAMPLE_IDS.projects,
  folderPath: "Projects",
  folderOutsideScope: false,
  sectionPath: null,
  body: "# Naming\n\nkebab-case everywhere.\n",
  metadata: {},
};

const note = "Projects/Web/Naming conventions";

export const NOTE_EXAMPLES = {
  read_outline: { arguments: { note }, result: { note: header, budget: 8000, sections } },
  read_section: {
    arguments: { note: EXAMPLE_IDS.note, section: "Branches" },
    result: { note: header, section: sectionText },
  },
  read_note: { arguments: { note: EXAMPLE_IDS.note }, result: { note: fullNote } },
  list_revisions: {
    arguments: { note: EXAMPLE_IDS.note },
    result: {
      noteId: EXAMPLE_IDS.note,
      path: header.path,
      revisions: [
        revision,
        {
          ...revision,
          version: 3,
          change: "moved",
          reason: "Belongs to the web project",
          actorName: "alex",
          createdAt: "2026-09-20T14:02:09.000Z",
          sectionPath: null,
        },
      ],
    },
  },
  read_revision: { arguments: { note: EXAMPLE_IDS.note, version: 1 }, result: snapshot },
} satisfies Record<string, McpToolExample>;
