import { z } from "zod";
import { requiredOr } from "../field-errors.ts";
import {
  CHANGES_LIMITS,
  FOLDER_NAME_MAX_LENGTH,
  folderNameSchema,
  idSchema,
  noteBodySchema,
  noteTitleSchema,
  SEARCH_LIMITS,
  SECTION_CHUNK_LIMITS,
  searchQuerySchema,
  TREE_DEPTH_LIMITS,
  versionSchema,
} from "../notes.ts";
import {
  boundedInt,
  expectedVersion,
  flag,
  folderReason,
  note,
  reason,
  section,
  title,
  wholeNumber,
} from "./input-fields.ts";
import { trashToolInputs } from "./inputs-trash.ts";

// Inputs of the MCP tools (apps/server/src/mcp), as Zod shapes: the server
// validates arguments with them (invalid ones: invalid_input with the codes of
// field-errors.ts) and announces them as the JSON schemas the agent sees.
// Same rules as the HTTP inputs (notes-api.ts), snake_case names.
// The descriptions are what an agent reads; docs/mcp.md is generated from
// them (tools/generate-mcp-docs.mjs).

export const mcpToolInputs = {
  get_overview: {},
  list_folder: {
    folder_id: idSchema
      .optional()
      .describe("Folder id from get_overview or list_folder; leave out for the root level."),
    depth: boundedInt(
      TREE_DEPTH_LIMITS,
      "Levels to list: 1 lists the folder's own subfolders and notes, each further level " +
        `opens the subfolders one step deeper (default ${TREE_DEPTH_LIMITS.default}).`,
    ),
  },
  search_notes: {
    query: searchQuerySchema.describe(
      "Words to find; all must occur in the same section (no stemming, case is ignored). " +
        'Supports "quoted phrases", OR between words and -word to exclude a word.',
    ),
    folder_id: idSchema
      .optional()
      .describe("Search only this folder and its subfolders; leave out to search everything."),
    limit: boundedInt(SEARCH_LIMITS, `Maximum hits (default ${SEARCH_LIMITS.default}).`),
  },
  read_outline: { note },
  read_section: {
    note,
    section,
    include_subsections: flag(
      "Include the section's subsections (default true); false returns only the " +
        "section's own text up to its first subsection.",
    ),
    offset: wholeNumber(0, SECTION_CHUNK_LIMITS.maxOffset)
      .optional()
      .describe(
        "Read a long section in pieces: start at this character (Unicode code point) of the " +
          "section's text (default 0). Pass nextOffset from the previous piece. An offset at " +
          "or past the end returns an empty piece with a notice.",
      ),
    limit: wholeNumber(1, SECTION_CHUNK_LIMITS.maxLimit)
      .optional()
      .describe(
        "At most this many characters (default: up to the end). A piece that does not reach " +
          "the end is cut after its last line break, so lines stay whole; a limit shorter " +
          "than the first line cuts inside that line.",
      ),
  },
  read_note: { note },
  list_changes: {
    since: z.iso
      .datetime({ offset: true, error: requiredOr("invalid_format") })
      .describe(
        "Only changes after this time: ISO 8601 with time zone, e.g. 2026-10-01T00:00:00Z.",
      ),
    limit: boundedInt(CHANGES_LIMITS, `Maximum notes listed (default ${CHANGES_LIMITS.default}).`),
  },
  create_note: {
    folder_id: idSchema
      .optional()
      .describe("Folder to create the note in; leave out for the root level."),
    title,
    body: noteBodySchema.describe(
      "The note's Markdown. Its headings (# to ######) split it into sections. Max 1 MiB.",
    ),
    reason: reason,
  },
  update_note: {
    note,
    expected_version: expectedVersion,
    title: noteTitleSchema
      .optional()
      .describe("New title (same rules as for create_note); leave out to keep the title."),
    body: noteBodySchema
      .optional()
      .describe(
        "New Markdown for the whole note, replacing the old body; leave out to keep it. " +
          "To change one section use replace_section.",
      ),
    reason: reason,
  },
  replace_section: {
    note,
    expected_version: expectedVersion,
    section,
    body: noteBodySchema.describe(
      "Markdown replacing the section from its heading line on. Start it with the heading " +
        "line (the same or a new one); an empty string removes the section. When a heading " +
        "follows and the text does not end with a blank line, one is added.",
    ),
    include_subsections: flag(
      "Replace the subsections as well (default true): the same range read_section returns. " +
        "With false only the section's own text up to its first subsection is replaced.",
    ),
    reason: reason,
  },
  move_note: {
    note,
    expected_version: expectedVersion,
    folder_id: idSchema
      .nullable()
      .describe("Target folder id, or null for the root level. Must be given."),
    reason: reason,
  },
  create_folder: {
    parent_id: idSchema
      .optional()
      .describe("Parent folder id; leave out to create the folder at the root level."),
    name: folderNameSchema.describe(
      `Folder name: unique among its siblings (case is ignored), max ${FOLDER_NAME_MAX_LENGTH} ` +
        "characters, no '/' or line breaks.",
    ),
    reason: folderReason,
  },
  rename_folder: {
    folder_id: idSchema.describe("The folder to rename (from get_overview or list_folder)."),
    name: folderNameSchema.describe(
      `New name: unique among its siblings (case is ignored), max ${FOLDER_NAME_MAX_LENGTH} ` +
        "characters, no '/' or line breaks.",
    ),
    reason: folderReason,
  },
  move_folder: {
    folder_id: idSchema.describe("The folder to move, with everything in it."),
    parent_id: idSchema
      .nullable()
      .describe("The new parent folder's id, or null for the root level. Must be given."),
    reason: folderReason,
  },
  list_revisions: { note },
  read_revision: {
    note,
    version: versionSchema.describe("The version to read, from list_revisions."),
  },
  ...trashToolInputs,
} as const;

export type McpToolName = keyof typeof mcpToolInputs;
