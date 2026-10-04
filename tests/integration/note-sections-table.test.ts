import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { expectAccepted, expectRefused, insertNote } from "./notes-harness";
import { insertUser, tryInsert, violation } from "./two-factor-harness";

// The note_sections table (migration 0005): the rules the database enforces
// on its own. The rows are derived from a note's body by the application.

let db: TestDatabase;
let userId: string;
let noteId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  noteId = await insertNote(db, userId);
});

const section = (values: Record<string, unknown> = {}) => ({
  note_id: noteId,
  position: 0,
  level: 0,
  heading: "",
  path: "(introduction)",
  start_offset: 0,
  end_offset: 10,
  subtree_end_offset: 10,
  characters: 10,
  approx_tokens: 3,
  search: "",
  ...values,
});

describe("note_sections", () => {
  it("accepts the introduction, levels 1-6, nested sections and empty ranges", async () => {
    await expectAccepted(db, "note_sections", section());
    for (const level of [1, 6]) {
      await expectAccepted(db, "note_sections", section({ level, heading: "H", path: "H" }));
    }
    await expectAccepted(
      db,
      "note_sections",
      section({ position: 2, parent_position: 1, level: 2, path: "A > B" }),
    );
    await expectAccepted(
      db,
      "note_sections",
      section({
        start_offset: 5,
        end_offset: 5,
        subtree_end_offset: 5,
        characters: 0,
        approx_tokens: 0,
      }),
    );
  });

  it("refuses levels outside 0-6, an empty path and impossible positions", async () => {
    await expectRefused(db, "note_sections", section({ level: 7 }), "note_sections_level_check");
    await expectRefused(db, "note_sections", section({ level: -1 }), "note_sections_level_check");
    await expectRefused(db, "note_sections", section({ path: "" }), "note_sections_path_check");
    await expectRefused(
      db,
      "note_sections",
      section({ position: -1 }),
      "note_sections_position_check",
    );
    const parent = "note_sections_parent_position_check";
    await expectRefused(db, "note_sections", section({ position: 1, parent_position: 1 }), parent);
    await expectRefused(db, "note_sections", section({ position: 1, parent_position: 2 }), parent);
    await expectRefused(db, "note_sections", section({ position: 1, parent_position: -1 }), parent);
  });

  it("refuses inconsistent offsets and negative sizes", async () => {
    const offsets = "note_sections_offsets_check";
    await expectRefused(db, "note_sections", section({ start_offset: -1 }), offsets);
    await expectRefused(db, "note_sections", section({ start_offset: 11 }), offsets);
    await expectRefused(db, "note_sections", section({ end_offset: 11 }), offsets);
    await expectRefused(db, "note_sections", section({ subtree_end_offset: 9 }), offsets);
    await expectRefused(
      db,
      "note_sections",
      section({ characters: -1 }),
      "note_sections_size_check",
    );
    await expectRefused(
      db,
      "note_sections",
      section({ approx_tokens: -1 }),
      "note_sections_size_check",
    );
  });

  it("allows each position of a note once and requires the search column", async () => {
    await db.sql`insert into note_sections ${db.sql(section({ position: 5 }))}`;
    await expectRefused(db, "note_sections", section({ position: 5 }), "note_sections_pkey");
    await expect(tryInsert(db, "note_sections", section({ search: null }))).rejects.toMatchObject(
      violation.notNull,
    );
  });

  it("finds sections by a search vector the application wrote", async () => {
    const other = await insertNote(db, userId);
    await db.sql`
      insert into note_sections (note_id, position, level, heading, path, start_offset, end_offset,
        subtree_end_offset, characters, approx_tokens, search)
      values (${other}, 1, 1, 'Setup', 'Setup', 0, 20, 20, 20, 5,
        setweight(to_tsvector('simple', 'Plan Setup'), 'A') || setweight(to_tsvector('simple', 'install docker'), 'B'))
    `;
    const hits = await db.sql`
      select path from note_sections where search @@ websearch_to_tsquery('simple', 'docker')
    `;
    expect(hits).toEqual([{ path: "Setup" }]);
  });
});
