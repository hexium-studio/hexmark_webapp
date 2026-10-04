import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { tsvector } from "./tsvector";

// Sections of a note's body, derived data: on every write the application
// parses the Markdown and replaces all rows of the note. The body stays the
// single source of truth; these rows can always be rebuilt from it.
export const noteSections = pgTable(
  "note_sections",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Order in the note, from 0.
    position: integer("position").notNull(),
    // 0: text before the first heading; 1-6: heading level.
    level: smallint("level").notNull(),
    // As written; empty for level 0.
    heading: text("heading").notNull(),
    // Address of the section, e.g. "Examples > Webapp vs. API".
    path: text("path").notNull(),
    // Enclosing section; null at the top. Not a foreign key: the rows are
    // replaced as a whole, and an enclosing section always comes first.
    parentPosition: integer("parent_position"),
    // Own text range in the body (without subsections), then the end
    // including subsections. Offsets as the application's parser counts them.
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    subtreeEndOffset: integer("subtree_end_offset").notNull(),
    // Size including subsections; tokens are an estimate (UTF-8 bytes / 4).
    characters: integer("characters").notNull(),
    approxTokens: integer("approx_tokens").notNull(),
    // Written by the application (note title + heading weight A, text weight B).
    search: tsvector("search").notNull(),
  },
  (table) => [
    primaryKey({ name: "note_sections_pkey", columns: [table.noteId, table.position] }),
    index("note_sections_search_idx").using("gin", table.search),
    check("note_sections_position_check", sql`${table.position} >= 0`),
    check("note_sections_level_check", sql`${table.level} between 0 and 6`),
    check("note_sections_path_check", sql`char_length(${table.path}) > 0`),
    check(
      "note_sections_parent_position_check",
      sql`${table.parentPosition} >= 0 and ${table.parentPosition} < ${table.position}`,
    ),
    check(
      "note_sections_offsets_check",
      sql`0 <= ${table.startOffset} and ${table.startOffset} <= ${table.endOffset} and ${table.endOffset} <= ${table.subtreeEndOffset}`,
    ),
    check("note_sections_size_check", sql`${table.characters} >= 0 and ${table.approxTokens} >= 0`),
  ],
);

export type NoteSection = typeof noteSections.$inferSelect;
export type NewNoteSection = typeof noteSections.$inferInsert;
