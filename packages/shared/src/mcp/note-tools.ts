import type { McpToolDefinition, McpToolError } from "./definition.ts";
import { NOTE_EXAMPLES } from "./examples-note.ts";
import { noteHeaderFields } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";

// Tools for reading one note: outline, a section, the whole note. Its
// revisions: history-tools.ts.

export const AMBIGUOUS_NOTE: McpToolError = [
  "ambiguous_note",
  "Several notes have that title; candidates lists their ids and paths.",
];

export const IN_TRASH: McpToolError = [
  "in_trash",
  "The note with that id is in the trash (details: deletedAt, purgeAt, batchId, path where " +
    "it was; batchRootId and batchRootPath when it went with a folder); restore it with " +
    "restore_note (or that folder with restore_folder) to use it.",
];

// A folder named by its id that is in the trash (within this token's folders;
// outside them it is folder_not_found).
export const FOLDER_IN_TRASH: McpToolError = [
  "folder_in_trash",
  "That folder is in the trash (details: folderId, path where it was, deletedAt, purgeAt, " +
    "batchId; batchRootId and batchRootPath when it went with a folder above it, which " +
    "restore_folder takes); restore it with restore_folder first.",
];

export const NOTE_ADDRESS_ERRORS: readonly McpToolError[] = [
  ["not_found", "No note this token can see has that id, title or path."],
  AMBIGUOUS_NOTE,
  IN_TRASH,
];

export const SECTION_ERRORS: readonly McpToolError[] = [
  [
    "section_not_found",
    "The note has no such section; paths lists the ones it has, section repeats yours.",
  ],
  [
    "ambiguous_section",
    "The path's end (e.g. a heading that occurs twice) names several sections; candidates " +
      "lists their full paths, section repeats the one you gave.",
  ],
];

export const readOutline = {
  name: "read_outline",
  title: "Read outline",
  permission: "read",
  readOnly: true,
  description:
    "Get a note's table of contents without its text: every section's path, heading level, " +
    "size in characters and estimated tokens (both including its subsections), and " +
    "overBudget for sections above the reading budget: read their subsections one by one, " +
    "or the section in chunks with read_section offset/limit. Also returns the note's " +
    "version. Use it before read_section for anything but small notes. Requires the read " +
    "permission.",
  input: input.read_outline,
  defaults: {},
  result: [
    ...noteHeaderFields("note"),
    ["budget", "integer", "The reading budget per section in estimated tokens."],
    ["sections[]", "array", "The note's sections in reading order."],
    ["sections[].position", "integer", "0, 1, 2, … in reading order."],
    ["sections[].level", "integer", "Heading level 1-6; 0 for the introduction."],
    ["sections[].heading", "string", "The heading's text."],
    ["sections[].path", "string", "Headings from the top joined by ' > ': the section's address."],
    ["sections[].parentPosition", "integer | null", "Position of the enclosing section."],
    ["sections[].characters", "integer", "Size including subsections, in characters."],
    ["sections[].approxTokens", "integer", "Estimated tokens including subsections."],
    [
      "sections[].overBudget",
      "boolean",
      "approxTokens is above budget: read subsections, or in chunks (offset/limit).",
    ],
  ],
  errors: NOTE_ADDRESS_ERRORS,
  example: NOTE_EXAMPLES.read_outline,
} satisfies McpToolDefinition<typeof input.read_outline>;

export const readSection = {
  name: "read_section",
  title: "Read section",
  permission: "read",
  readOnly: true,
  description:
    "Read one section's Markdown from its heading line on, including its subsections unless " +
    "include_subsections is false. Take section paths from read_outline or search_notes. " +
    "For a section above the reading budget pass limit (and then offset: nextOffset) to " +
    "read it in pieces cut at line ends. Also returns the note's version: pass it as " +
    "expected_version to replace_section. Requires the read permission.",
  input: input.read_section,
  defaults: { include_subsections: true },
  result: [
    ...noteHeaderFields("note"),
    ["section.path", "string", "The section's full path (also when you gave the heading only)."],
    ["section.level", "integer", "Heading level 1-6; 0 for the introduction."],
    ["section.heading", "string", "The heading's text."],
    ["section.includesSubsections", "boolean", "Whether text includes the subsections."],
    ["section.text", "string", "The Markdown, from the heading line on, as stored (or the piece)."],
    ["section.characters", "integer", "Length of text in characters."],
    ["section.approxTokens", "integer", "Estimated tokens of text."],
    ["section.offset", "integer", "Where text starts in the section, in characters."],
    ["section.returned", "integer", "Characters in text (the same as characters)."],
    ["section.total", "integer", "Characters in the whole section."],
    ["section.hasMore", "boolean", "true when text stops before the section's end."],
    ["section.nextOffset", "integer | null", "offset of the next piece; null at the end."],
    [
      "section.notice",
      "string (optional)",
      "Only when offset is at or past the end: says so (the piece is empty).",
    ],
    [
      "section.requestedOffset",
      "integer (optional)",
      "Only when offset is past the end: the offset you asked for (offset is then total).",
    ],
  ],
  errors: [...NOTE_ADDRESS_ERRORS, ...SECTION_ERRORS],
  example: NOTE_EXAMPLES.read_section,
} satisfies McpToolDefinition<typeof input.read_section>;

export const readNote = {
  name: "read_note",
  title: "Read note",
  permission: "read",
  readOnly: true,
  description:
    "Read a whole note: Markdown body, metadata, size (characters and estimated tokens) " +
    "and its version (pass it as expected_version to update_note). For large notes use " +
    "read_outline and read_section instead; a note above the reading budget comes with a " +
    "hint. Requires the read permission.",
  input: input.read_note,
  defaults: {},
  result: [
    ...noteHeaderFields("note"),
    ["note.body", "string", "The whole Markdown body."],
    ["note.metadata", "object", "Front matter kept from an import; usually {}."],
    ["note.characters", "integer", "Length of the body in characters (code points)."],
    ["note.approxTokens", "integer", "Estimated tokens of the body."],
    ["hint", "string (optional)", "Present when the note is above the reading budget."],
  ],
  errors: NOTE_ADDRESS_ERRORS,
  example: NOTE_EXAMPLES.read_note,
} satisfies McpToolDefinition<typeof input.read_note>;
