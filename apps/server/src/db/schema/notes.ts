import { NOTE_BODY_MAX_BYTES, NOTE_TITLE_MAX_LENGTH } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { actorChecks, actorColumns } from "./actor-columns";
import { folders } from "./folders";
import { hiddenChecks, hiddenColumns, hiddenIndexes } from "./hidden-columns";
import { idColumn } from "./id-column";
import { lockChecks, lockColumns } from "./lock-columns";
import { trashChecks, trashColumns, trashIndexes } from "./trash-columns";
import { tsvector } from "./tsvector";

// Limits shared with the input schemas (@hexmark/shared). The body limit is
// in bytes (UTF-8).
export { NOTE_BODY_MAX_BYTES, NOTE_TITLE_MAX_LENGTH };

const createdBy = actorColumns("created_by");
const updatedBy = actorColumns("updated_by");
const lock = lockColumns();
const trash = trashColumns();
const hide = hiddenColumns();

// Shared by notes and note_revisions (a revision is a full snapshot).
export const noteTitleMaxSql = sql.raw(String(NOTE_TITLE_MAX_LENGTH));
export const noteBodyMaxBytesSql = sql.raw(String(NOTE_BODY_MAX_BYTES));

// Markdown notes. Addressed by id; renaming or moving never changes it.
// Every change of content, title or location raises `version` by one and
// writes a row to note_revisions.
export const notes = pgTable(
  "notes",
  {
    id: idColumn(),
    // Null: root level. A folder that still holds notes (also in the trash)
    // cannot be deleted.
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Front matter (import/export); always a JSON object.
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    // Kept up to date by PostgreSQL itself: the title weighs more than the body.
    // The 'simple' configuration does no stemming, so it works the same for
    // every language a note may be written in.
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', "body"), 'B')`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: createdBy.userId,
    createdByTokenId: createdBy.tokenId,
    createdByName: createdBy.name.notNull(),
    updatedByUserId: updatedBy.userId,
    updatedByTokenId: updatedBy.tokenId,
    updatedByName: updatedBy.name.notNull(),
    // Trash; null while the note is in use.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Who moved it there and with which batch (trash-columns.ts).
    deletedByUserId: trash.deletedByUserId,
    deletedByTokenId: trash.deletedByTokenId,
    deletedByName: trash.deletedByName,
    trashBatchId: trash.trashBatchId,
    // Locked (agents may not change the note; lock-columns.ts); null while
    // the note is not locked.
    lockedAt: lock.lockedAt,
    lockedByUserId: lock.lockedByUserId,
    lockedByTokenId: lock.lockedByTokenId,
    lockedByName: lock.lockedByName,
    lockReason: lock.lockReason,
    // Hidden (agents cannot read its content; hidden-columns.ts); null while
    // the note is not hidden.
    hiddenAt: hide.hiddenAt,
    hiddenByUserId: hide.hiddenByUserId,
    hiddenByTokenId: hide.hiddenByTokenId,
    hiddenByName: hide.hiddenByName,
    hideReason: hide.hideReason,
    // Derived from hidden_at by PostgreSQL (migration 0011 replaced the
    // plain flag), so a server of the previous version, which selects it,
    // keeps working. Nothing new should read it; hidden_at is the source.
    hidden: boolean("hidden").notNull().generatedAlwaysAs(sql`"hidden_at" is not null`),
  },
  (table) => [
    // Titles are unique within a folder regardless of case, ignoring notes in
    // the trash, so export paths stay unambiguous. Root level separately, as
    // null folders never compare equal in a unique index.
    uniqueIndex("notes_folder_id_title_unique")
      .on(table.folderId, sql`lower(${table.title})`)
      .where(sql`${table.folderId} is not null and ${table.deletedAt} is null`),
    uniqueIndex("notes_root_title_unique")
      .on(sql`lower(${table.title})`)
      .where(sql`${table.folderId} is null and ${table.deletedAt} is null`),
    index("notes_search_idx").using("gin", table.search),
    index("notes_updated_at_idx").on(table.updatedAt),
    check(
      "notes_title_length_check",
      sql`char_length(${table.title}) between 1 and ${noteTitleMaxSql}`,
    ),
    check("notes_body_size_check", sql`octet_length(${table.body}) <= ${noteBodyMaxBytesSql}`),
    check("notes_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check("notes_version_check", sql`${table.version} >= 1`),
    ...actorChecks("notes", "created_by", {
      userId: table.createdByUserId,
      tokenId: table.createdByTokenId,
      name: table.createdByName,
    }),
    ...actorChecks("notes", "updated_by", {
      userId: table.updatedByUserId,
      tokenId: table.updatedByTokenId,
      name: table.updatedByName,
    }),
    ...lockChecks("notes", table),
    ...hiddenChecks("notes", table),
    ...hiddenIndexes("notes", table),
    ...trashChecks("notes", table),
    ...trashIndexes("notes", table),
  ],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
