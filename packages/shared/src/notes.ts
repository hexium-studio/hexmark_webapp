import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors.ts";

// Notes, folders and their revisions: limits and field schemas shared by the
// server (which enforces them, also as database checks) and the web app.
// The endpoints are described in apps/server/src/api/notes/v1/index.ts.

export const FOLDER_NAME_MAX_LENGTH = 120;
export const NOTE_TITLE_MAX_LENGTH = 200;
// Technical limit of a note's Markdown body, in bytes (UTF-8).
export const NOTE_BODY_MAX_BYTES = 1_048_576;
export const REVISION_REASON_MAX_LENGTH = 500;
// Longest section path a revision records for a section-level edit.
export const REVISION_SECTION_PATH_MAX_LENGTH = 1000;

// What a note permission allows (docs/design/notes-and-agents.md, section 3).
export const NOTE_PERMISSIONS = [
  "read",
  "search",
  "create",
  "edit",
  "move",
  "delete",
  "lock",
  "hide",
] as const;
export type NotePermission = (typeof NOTE_PERMISSIONS)[number];

// Kind of change a revision records.
export const NOTE_CHANGES = [
  "created",
  "edited",
  "renamed",
  "moved",
  "deleted",
  "restored",
] as const;
export type NoteChange = (typeof NOTE_CHANGES)[number];

// Separates folder names and the title in a note's path
// ("Projects/Web/Naming conventions"), hence not allowed in names and titles.
export const PATH_SEPARATOR = "/";

// Separates headings in a section path ("Examples > Webapp vs. API").
export const SECTION_PATH_SEPARATOR = " > ";

// Path of the text before a note's first heading.
export const INTRODUCTION_SECTION_PATH = "(introduction)";

const code = (value: FieldErrorCode) => value;

// No path separator and no control characters (line breaks, tabs): names and
// titles become path segments and, on export, file names.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const NAME_FORBIDDEN = /[/\u0000-\u001f\u007f]/;

export function isValidName(value: string): boolean {
  return !NAME_FORBIDDEN.test(value);
}

function nameSchema(max: number) {
  return z
    .string({ error: requiredOr("invalid_type") })
    .trim()
    .min(1, code("empty"))
    .max(max, code("too_long"))
    .refine(isValidName, { message: code("invalid_format") });
}

export const folderNameSchema = nameSchema(FOLDER_NAME_MAX_LENGTH);
export const noteTitleSchema = nameSchema(NOTE_TITLE_MAX_LENGTH);

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

// The one size rule for bodies: checked on input and again for the body that
// results from replacing a section.
export function isNoteBodyWithinLimit(body: string): boolean {
  // Cheap bound first: a UTF-16 unit is at most 3 UTF-8 bytes.
  return body.length * 3 <= NOTE_BODY_MAX_BYTES || utf8Length(body) <= NOTE_BODY_MAX_BYTES;
}

// Markdown, stored as sent (no trimming). The limit is in bytes; it reaches
// the client as params of too_long.
export const noteBodySchema = z
  .string({ error: requiredOr("invalid_type") })
  .refine(isNoteBodyWithinLimit, {
    message: code("too_long"),
    params: { maxBytes: NOTE_BODY_MAX_BYTES },
  });

// Why the change was made; blank counts as none.
export const reasonSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .max(REVISION_REASON_MAX_LENGTH, code("too_long"))
  .transform((value) => (value === "" ? undefined : value))
  .optional();

// Front matter of a note (kept for import and export): a JSON object.
export const noteMetadataSchema = z.record(z.string(), z.unknown(), {
  error: code("invalid_type"),
});

export const versionSchema = z
  .number({ error: requiredOr("invalid_type") })
  .int(code("invalid_type"))
  .min(1, code("invalid"));

export const idSchema = z.uuid({ error: requiredOr("invalid_format") });

// A folder id, or null for the root level.
export const folderRefSchema = z.union([idSchema, z.null()], {
  error: requiredOr("invalid_format"),
});

// Path of a section as the outline lists it, or its end (down to the last
// heading alone) when that names one section only.
export const sectionPathSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(1, code("empty"))
  .max(2_000, code("too_long"));

// How a note may be named wherever a client addresses it: its id, its title,
// or the folder path and title ("Projects/Naming conventions"; a leading "/"
// means the root level).
export const noteAddressSchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(1, code("empty"))
  .max(4_000, code("too_long"));

// Search query in web search syntax ("quoted phrase", or, -exclude).
export const searchQuerySchema = z
  .string({ error: requiredOr("invalid_type") })
  .trim()
  .min(1, code("empty"))
  .max(500, code("too_long"));

export const SEARCH_LIMITS = { default: 20, max: 50 } as const;
export const TREE_DEPTH_LIMITS = { default: 1, max: 10 } as const;
export const CHANGES_LIMITS = { default: 100, max: 500 } as const;
// Entries of one trash listing.
export const TRASH_LIST_LIMITS = { default: 50, max: 500 } as const;
// How long notes and folders stay in the trash before the server purges
// them, in days (TRASH_RETENTION_DAYS, apps/server/src/config/trash.ts).
export const TRASH_RETENTION_DAYS = { default: 28, min: 1, max: 3650 } as const;
// Reading a section in pieces: offset and limit in characters (code points,
// like the stored offsets). Without a limit the rest of the section is read.
export const SECTION_CHUNK_LIMITS = {
  maxOffset: NOTE_BODY_MAX_BYTES,
  maxLimit: NOTE_BODY_MAX_BYTES,
} as const;
