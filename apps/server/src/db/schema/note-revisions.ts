import {
  NOTE_CHANGES,
  type NoteChange,
  REVISION_REASON_MAX_LENGTH,
  REVISION_SECTION_PATH_MAX_LENGTH,
} from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { actorChecks, actorColumns } from "./actor-columns";
import { idColumn } from "./id-column";
import { noteBodyMaxBytesSql, notes, noteTitleMaxSql } from "./notes";

// Kind of change a revision records (NOTE_CHANGES in @hexmark/shared).
// Changing the list needs a migration of note_revisions_change_check below.
export {
  NOTE_CHANGES,
  type NoteChange,
  REVISION_REASON_MAX_LENGTH,
  REVISION_SECTION_PATH_MAX_LENGTH,
};

const actor = actorColumns("actor");
const changeList = sql.raw(NOTE_CHANGES.map((change) => `'${change}'`).join(", "));

// One row per version of a note: a full snapshot of title, body, location and
// metadata, who made the change and why.
export const noteRevisions = pgTable(
  "note_revisions",
  {
    id: idColumn(),
    // Purging a note removes its history.
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Where the note was at this version. Deliberately no foreign key: a
    // snapshot must neither block deleting that folder later nor change
    // when it is deleted.
    folderId: uuid("folder_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    change: text("change", { enum: NOTE_CHANGES }).notNull(),
    reason: text("reason"),
    // Heading path ("Examples > Webapp vs. API") of the one section a
    // section-level edit such as replace_section changed, as it was named
    // when the change was made. Null when the change concerns the whole note
    // (create, full edit, rename, move, delete, restore) and for every
    // revision written before migration 0006, which did not record it.
    sectionPath: text("section_path"),
    actorUserId: actor.userId,
    actorTokenId: actor.tokenId,
    actorName: actor.name.notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Also serves listing a note's revisions.
    unique("note_revisions_note_id_version_unique").on(table.noteId, table.version),
    check("note_revisions_version_check", sql`${table.version} >= 1`),
    check(
      "note_revisions_title_length_check",
      sql`char_length(${table.title}) between 1 and ${noteTitleMaxSql}`,
    ),
    check(
      "note_revisions_body_size_check",
      sql`octet_length(${table.body}) <= ${noteBodyMaxBytesSql}`,
    ),
    check("note_revisions_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check("note_revisions_change_check", sql`${table.change} in (${changeList})`),
    check(
      "note_revisions_reason_length_check",
      sql`char_length(${table.reason}) <= ${sql.raw(String(REVISION_REASON_MAX_LENGTH))}`,
    ),
    // Null, or 1-1000 characters with at least one that is not white space.
    check(
      "note_revisions_section_path_check",
      sql`char_length(${table.sectionPath}) between 1 and ${sql.raw(String(REVISION_SECTION_PATH_MAX_LENGTH))} and ${table.sectionPath} ~ '[^[:space:]]'`,
    ),
    ...actorChecks("note_revisions", "actor", {
      userId: table.actorUserId,
      tokenId: table.actorTokenId,
      name: table.actorName,
    }),
  ],
);

export type NoteRevision = typeof noteRevisions.$inferSelect;
export type NewNoteRevision = typeof noteRevisions.$inferInsert;
