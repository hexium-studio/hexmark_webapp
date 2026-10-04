import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { byUser, expectAccepted, expectRefused, insertNote } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// note_revisions.section_path (migration 0006): null for whole-note changes,
// otherwise the heading path of the edited section, 1-1000 characters and not
// only white space. Checked in both directions, so a loosened rule would show.

const CHECK = "note_revisions_section_path_check";

let db: TestDatabase;
let userId: string;
let noteId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  noteId = await insertNote(db, userId);
});

const revision = (sectionPath: string | null) => ({
  note_id: noteId,
  version: 1,
  title: "Plan",
  body: "# Plan",
  change: "edited",
  section_path: sectionPath,
  ...byUser("actor", userId),
});

describe("note_revisions.section_path", () => {
  it("accepts null, a single heading, a nested path and exactly 1000 characters", async () => {
    await expectAccepted(db, "note_revisions", revision(null));
    await expectAccepted(db, "note_revisions", revision("x"));
    await expectAccepted(db, "note_revisions", revision("Plan"));
    await expectAccepted(db, "note_revisions", revision("Examples > Webapp vs. API"));
    await expectAccepted(db, "note_revisions", revision("(introduction)"));
    await expectAccepted(db, "note_revisions", revision(" Padded heading "));
    await expectAccepted(db, "note_revisions", revision("p".repeat(1000)));
    // Counted in characters, not bytes.
    await expectAccepted(db, "note_revisions", revision("ä".repeat(1000)));
  });

  it("is null when not given", async () => {
    const [row] = await db.sql`
      insert into note_revisions (note_id, version, title, body, change, actor_user_id, actor_name)
      values (${noteId}, 7, 'Plan', '', 'created', ${userId}, 'owner')
      returning section_path
    `;
    expect(row).toEqual({ section_path: null });
  });

  it("refuses an empty, a white-space-only and a 1001-character path", async () => {
    await expectRefused(db, "note_revisions", revision(""), CHECK);
    await expectRefused(db, "note_revisions", revision(" "), CHECK);
    await expectRefused(db, "note_revisions", revision("   "), CHECK);
    await expectRefused(db, "note_revisions", revision("\t\n "), CHECK);
    await expectRefused(db, "note_revisions", revision("p".repeat(1001)), CHECK);
    await expectRefused(db, "note_revisions", revision("ä".repeat(1001)), CHECK);
  });

  it("also refuses an invalid value written by an update", async () => {
    const [row] = await db.sql`
      insert into note_revisions ${db.sql(revision("Plan"))}
      returning id
    `;
    await expect(
      db.sql`update note_revisions set section_path = '' where id = ${row?.id}`,
    ).rejects.toMatchObject({ constraint_name: CHECK });
    await db.sql`update note_revisions set section_path = null where id = ${row?.id}`;
    await db.sql`delete from note_revisions where id = ${row?.id}`;
  });
});
