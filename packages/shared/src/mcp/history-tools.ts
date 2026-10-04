import type { McpToolDefinition } from "./definition.ts";
import { NOTE_EXAMPLES } from "./examples-note.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { AMBIGUOUS_NOTE, HIDDEN_NOTE, IN_TRASH, NOTE_ADDRESS_ERRORS } from "./note-tools.ts";

// Tools for a note's history: its versions and one of them in full.

export const listRevisions = {
  name: "list_revisions",
  title: "List revisions",
  permission: "read",
  readOnly: true,
  description:
    "List every version of a note, newest first: version number, time, author name " +
    "(username or token name), kind of change, reason, the section an edit changed, and the " +
    "title and folder at that version. Read one in full with read_revision. Requires the " +
    "read permission.",
  input: input.list_revisions,
  defaults: {},
  result: [
    ["noteId", "string (uuid)", "The note's id."],
    ["path", "string", "The note's current path."],
    ["revisions[]", "array", "Every version, newest first."],
    ["revisions[].version", "integer", "The version number."],
    [
      "revisions[].change",
      "string",
      "What it changed: created, edited, renamed, moved, deleted or restored.",
    ],
    ["revisions[].reason", "string | null", "The reason given with the change."],
    ["revisions[].actorName", "string", "Who made it: username or token name, as it was then."],
    ["revisions[].createdAt", "string (ISO 8601)", "When it was written."],
    ["revisions[].title", "string", "The note's title at that version."],
    [
      "revisions[].folderId",
      "string | null",
      "The note's folder at that version; null at the root or outside this token's folders.",
    ],
    [
      "revisions[].folderPath",
      "string | null",
      "That folder's current path ('' at the root); null if it no longer exists or lies " +
        "outside this token's folders.",
    ],
    [
      "revisions[].folderOutsideScope",
      "boolean",
      "True when that folder lies outside this token's folders; its id and path are not shown.",
    ],
    [
      "revisions[].sectionPath",
      "string | null",
      "The section a replace_section changed, as its path was then; null for whole-note " +
        "changes, for versions written before this was recorded, and for a hidden note " +
        "(headings are its content).",
    ],
  ],
  errors: NOTE_ADDRESS_ERRORS,
  example: NOTE_EXAMPLES.list_revisions,
} satisfies McpToolDefinition<typeof input.list_revisions>;

export const readRevision = {
  name: "read_revision",
  title: "Read revision",
  permission: "read",
  readOnly: true,
  description:
    "Read the full snapshot of one version of a note: title, Markdown body, metadata, " +
    "folder, author name, kind of change and reason. Use it to see what an earlier version " +
    "said, or to bring old text back with update_note. Requires the read permission.",
  input: input.read_revision,
  defaults: {},
  result: [
    ["noteId", "string (uuid)", "The note's id."],
    ["version", "integer", "The version number."],
    ["change", "string", "What it changed: created, edited, renamed, moved, deleted, restored."],
    ["reason", "string | null", "The reason given with the change."],
    ["actorName", "string", "Who made it: username or token name, as it was then."],
    ["createdAt", "string (ISO 8601)", "When it was written."],
    ["title", "string", "The title at that version."],
    ["folderId", "string | null", "The folder at that version; null at the root or outside."],
    ["folderPath", "string | null", "That folder's current path; null if gone or outside."],
    ["folderOutsideScope", "boolean", "True when that folder lies outside this token's folders."],
    ["sectionPath", "string | null", "The section a replace_section changed; else null."],
    ["body", "string", "The whole Markdown body at that version."],
    ["metadata", "object", "Front matter at that version."],
  ],
  errors: [
    ["not_found", "No such note visible to this token, or the note has no such version."],
    AMBIGUOUS_NOTE,
    IN_TRASH,
    HIDDEN_NOTE,
  ],
  example: NOTE_EXAMPLES.read_revision,
} satisfies McpToolDefinition<typeof input.read_revision>;
