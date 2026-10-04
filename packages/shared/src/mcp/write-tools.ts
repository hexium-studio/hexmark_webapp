import type { McpToolDefinition, McpToolError } from "./definition.ts";
import { WRITE_EXAMPLES } from "./examples-write.ts";
import { WRITE_RESULT_FIELDS } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH, NOTE_ADDRESS_ERRORS, SECTION_ERRORS } from "./note-tools.ts";

// Tools that change notes. Every change of an existing note states the
// version it is based on; a newer version is a version_conflict. Folders:
// folder-tools.ts.

const CONFLICT: McpToolError = [
  "version_conflict",
  "The note has a newer version than expected_version (details: currentVersion, " +
    "updatedAt, updatedBy, lastChange: change, reason, sectionPath). Nothing was written.",
];

export const TARGET_FOLDER: readonly McpToolError[] = [
  ["folder_not_found", "The target folder does not exist."],
  FOLDER_IN_TRASH,
  [
    "forbidden",
    "The target (or the root level) is outside this token's folders (reason: outside_scope).",
  ],
];

const TITLE_TAKEN: McpToolError = [
  "title_taken",
  "The folder already has a note with this title, case ignored (details: existingNoteId, " +
    "path).",
];

export const createNote = {
  name: "create_note",
  title: "Create note",
  permission: "create",
  readOnly: false,
  description:
    "Create a note in a folder, or at the root level when folder_id is left out, with a " +
    "short reason. Returns the new note's id (keep it: ids never change), version 1 and " +
    "path, plus warnings for sections above the reading budget. Requires the create " +
    "permission.",
  input: input.create_note,
  defaults: {},
  result: WRITE_RESULT_FIELDS,
  errors: [...TARGET_FOLDER, TITLE_TAKEN],
  example: WRITE_EXAMPLES.create_note,
} satisfies McpToolDefinition<typeof input.create_note>;

export const updateNote = {
  name: "update_note",
  title: "Update note",
  permission: "edit",
  readOnly: false,
  description:
    "Replace a note's title and/or its whole body. Pass expected_version from your last " +
    "read and a short reason. On version_conflict read the note again, merge your change " +
    "and retry with the new version. To change one section use replace_section instead. " +
    "Returns the new version (changed is false, and the version stays, when nothing " +
    "differs). Requires the edit permission.",
  input: input.update_note,
  defaults: {},
  result: WRITE_RESULT_FIELDS,
  errors: [...NOTE_ADDRESS_ERRORS, CONFLICT, TITLE_TAKEN],
  example: WRITE_EXAMPLES.update_note,
} satisfies McpToolDefinition<typeof input.update_note>;

export const replaceSection = {
  name: "replace_section",
  title: "Replace section",
  permission: "edit",
  readOnly: false,
  description:
    "Replace one section of a note, from its heading line on (with its subsections unless " +
    "include_subsections is false), by the given Markdown, which should start with the " +
    "heading line. Pass expected_version from your last read and a short reason. On " +
    "version_conflict the error carries the section's current text: merge your change and " +
    "retry with currentVersion. Returns the new version. Requires the edit permission.",
  input: input.replace_section,
  defaults: { include_subsections: true },
  result: WRITE_RESULT_FIELDS,
  errors: [
    ...NOTE_ADDRESS_ERRORS,
    ...SECTION_ERRORS,
    [
      "version_conflict",
      "As for update_note; details also carry currentSection (path, text), the section's " +
        "current text, or null when it is gone.",
    ],
    [
      "invalid_input",
      "Also when the note would exceed 1 MiB after the replacement (fields.body: too_long).",
    ],
  ],
  example: WRITE_EXAMPLES.replace_section,
} satisfies McpToolDefinition<typeof input.replace_section>;

export const moveNote = {
  name: "move_note",
  title: "Move note",
  permission: "move",
  readOnly: false,
  description:
    "Move a note into another folder (folder_id null: the root level); its id stays the " +
    "same. Pass expected_version from your last read and a short reason. Returns the new " +
    "version and path. Fails with title_taken when the target folder already has a note " +
    "with that title. Requires the move permission.",
  input: input.move_note,
  defaults: {},
  result: WRITE_RESULT_FIELDS,
  errors: [...NOTE_ADDRESS_ERRORS, CONFLICT, ...TARGET_FOLDER, TITLE_TAKEN],
  example: WRITE_EXAMPLES.move_note,
} satisfies McpToolDefinition<typeof input.move_note>;
