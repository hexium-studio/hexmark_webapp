import { z } from "zod";
import { type FieldErrorCode, requiredOr } from "./field-errors";
import {
  CHANGES_LIMITS,
  folderNameSchema,
  folderRefSchema,
  idSchema,
  noteBodySchema,
  noteMetadataSchema,
  noteTitleSchema,
  reasonSchema,
  SEARCH_LIMITS,
  SECTION_CHUNK_LIMITS,
  searchQuerySchema,
  sectionPathSchema,
  TRASH_LIST_LIMITS,
  TREE_DEPTH_LIMITS,
  versionSchema,
} from "./notes";

// Request bodies and query strings of /api/notes/v1 (session or bearer
// token). The endpoints and their answers are described in
// apps/server/src/api/notes/v1/index.ts; the MCP tools take the same rules
// with snake_case names (mcp/inputs.ts).

const code = (value: FieldErrorCode) => value;

// Query values arrive as strings.
function queryInt(limits: { default: number; max: number }) {
  return z.coerce
    .number({ error: code("invalid_type") })
    .int(code("invalid_type"))
    .min(1, code("invalid"))
    .max(limits.max, code("too_long"))
    .default(limits.default);
}

// Optional whole number from a query string, within [min, max].
function optionalQueryInt(min: number, max: number) {
  return z.coerce
    .number({ error: code("invalid_type") })
    .int(code("invalid_type"))
    .min(min, code("invalid"))
    .max(max, code("too_long"))
    .optional();
}

const queryBoolean = z
  .enum(["true", "false"], { error: code("invalid_option") })
  .default("true")
  .transform((value) => value === "true");

export const treeQuerySchema = z.object({
  folder: idSchema.optional(),
  depth: queryInt(TREE_DEPTH_LIMITS),
});

export const NOTE_VIEWS = ["full", "outline", "section"] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];

export const noteViewQuerySchema = z
  .object({
    view: z.enum(NOTE_VIEWS, { error: code("invalid_option") }).default("full"),
    section: sectionPathSchema.optional(),
    subsections: queryBoolean,
    // view=section only: read a piece of the section (see readSection).
    offset: optionalQueryInt(0, SECTION_CHUNK_LIMITS.maxOffset),
    limit: optionalQueryInt(1, SECTION_CHUNK_LIMITS.maxLimit),
  })
  .refine((query) => query.view !== "section" || query.section !== undefined, {
    message: code("required"),
    path: ["section"],
  });

export const searchQueryParamsSchema = z.object({
  q: searchQuerySchema,
  folder: idSchema.optional(),
  limit: queryInt(SEARCH_LIMITS),
});

// ISO 8601 with a time zone (e.g. 2026-10-03T12:00:00Z).
export const sinceSchema = z
  .string({ error: requiredOr("invalid_type") })
  .pipe(z.iso.datetime({ offset: true, error: code("invalid_format") }))
  .transform((value) => new Date(value));

export const changesQuerySchema = z.object({
  since: sinceSchema,
  limit: queryInt(CHANGES_LIMITS),
});

export const createNoteInputSchema = z.object({
  folderId: folderRefSchema.optional().transform((value) => value ?? null),
  title: noteTitleSchema,
  body: noteBodySchema,
  metadata: noteMetadataSchema.optional(),
  reason: reasonSchema,
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z
  .object({
    expectedVersion: versionSchema,
    title: noteTitleSchema.optional(),
    body: noteBodySchema.optional(),
    reason: reasonSchema,
  })
  .refine((input) => input.title !== undefined || input.body !== undefined, {
    message: code("required"),
    path: ["title"],
  });
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

// `heading`: the section's path (as in the outline). `body` replaces the
// section from its heading line on, so it normally starts with the heading;
// with includeSubsections (default) the subsections are replaced as well.
export const replaceSectionInputSchema = z.object({
  expectedVersion: versionSchema,
  heading: sectionPathSchema,
  body: noteBodySchema,
  includeSubsections: z.boolean({ error: code("invalid_type") }).default(true),
  reason: reasonSchema,
});
export type ReplaceSectionInput = z.infer<typeof replaceSectionInputSchema>;

export const moveNoteInputSchema = z.object({
  expectedVersion: versionSchema,
  folderId: folderRefSchema,
  reason: reasonSchema,
});
export type MoveNoteInput = z.infer<typeof moveNoteInputSchema>;

export const deleteNoteInputSchema = z.object({
  expectedVersion: versionSchema,
  reason: reasonSchema,
});

// folderId left out: back into the folder it was deleted from; a folder id
// or null (root level): restore it there instead. title: restore it under
// this title (e.g. when a note there holds its old one now).
export const restoreNoteInputSchema = z.object({
  folderId: folderRefSchema.optional(),
  title: noteTitleSchema.optional(),
  reason: reasonSchema,
});
export type RestoreNoteInput = z.infer<typeof restoreNoteInputSchema>;

export const createFolderInputSchema = z.object({
  parentId: folderRefSchema.optional().transform((value) => value ?? null),
  name: folderNameSchema,
  reason: reasonSchema,
});
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

// Folders keep no history; the reason is recorded in the audit log.
export const renameFolderInputSchema = z.object({ name: folderNameSchema, reason: reasonSchema });

export const moveFolderInputSchema = z.object({ parentId: folderRefSchema, reason: reasonSchema });

// Moving a folder to the trash (with everything in it) and restoring it. The
// reason is recorded in the revisions of the notes it takes along.
export const deleteFolderInputSchema = z.object({ reason: reasonSchema });
export const restoreFolderInputSchema = z.object({ reason: reasonSchema });

// Locking and unlocking a note or folder (POST .../lock, .../unlock). An
// agent must give a reason for locking; people may leave it out.
export const lockInputSchema = z.object({ reason: reasonSchema });

// Hiding and unhiding a note or folder (POST .../hide, .../unhide). An agent
// must give a reason for hiding; people may leave it out.
export const hideInputSchema = z.object({ reason: reasonSchema });

export const trashQuerySchema = z.object({
  folder: idSchema.optional(),
  limit: queryInt(TRASH_LIST_LIMITS),
});
