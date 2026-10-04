import { describe, expect, it } from "vitest";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { byToken, byUser, insertFolder, insertNote, insertRow, insertToken } from "./notes-harness";
import { count, insertUser } from "./two-factor-harness";

// What deleting users, tokens and notes does to the tables of migration 0005:
// history keeps the actor names, derived rows go with their note, and nothing
// of anybody else is touched.

const ACTOR_COLUMNS = `
  created_by_user_id, created_by_token_id, created_by_name,
  updated_by_user_id, updated_by_token_id, updated_by_name`;

describe("deleting users and tokens", () => {
  it("cascades to the user's tokens and clears the ids in history, keeping the names", async () => {
    const db = await newDatabase();
    await migrate(db);
    const leaving = await insertUser(db, "leaving");
    const staying = await insertUser(db, "staying");
    const leavingToken = await insertToken(db, leaving, { name: "leaving-agent" });
    const stayingToken = await insertToken(db, staying, { name: "staying-agent" });

    const folderId = await insertFolder(db, leaving, {
      ...byUser("created_by", leaving, "leaving"),
      updated_by_user_id: null,
      ...byToken("updated_by", stayingToken, "staying-agent"),
    });
    const noteId = await insertNote(db, leaving, {
      folder_id: folderId,
      created_by_user_id: null,
      ...byToken("created_by", leavingToken, "leaving-agent"),
      ...byUser("updated_by", staying, "staying"),
      locked_at: new Date(),
      ...byUser("locked_by", leaving, "leaving"),
    });
    await insertRow(db, "note_revisions", {
      note_id: noteId,
      version: 1,
      title: "t",
      body: "",
      change: "created",
      ...byToken("actor", leavingToken, "leaving-agent"),
    });

    await db.sql`delete from users where id = ${leaving}`;

    expect(await db.sql`select ${db.sql.unsafe(ACTOR_COLUMNS)} from folders`).toEqual([
      {
        created_by_user_id: null,
        created_by_token_id: null,
        created_by_name: "leaving",
        updated_by_user_id: null,
        updated_by_token_id: stayingToken,
        updated_by_name: "staying-agent",
      },
    ]);
    expect(
      await db.sql`
        select ${db.sql.unsafe(ACTOR_COLUMNS)}, locked_by_user_id, locked_by_name, locked_at is not null as locked
        from notes`,
    ).toEqual([
      {
        created_by_user_id: null,
        created_by_token_id: null,
        created_by_name: "leaving-agent",
        updated_by_user_id: staying,
        updated_by_token_id: null,
        updated_by_name: "staying",
        locked_by_user_id: null,
        locked_by_name: "leaving",
        locked: true,
      },
    ]);
    expect(
      await db.sql`select actor_user_id, actor_token_id, actor_name from note_revisions`,
    ).toEqual([{ actor_user_id: null, actor_token_id: null, actor_name: "leaving-agent" }]);
    expect(await db.sql`select id, name from api_tokens`).toEqual([
      { id: stayingToken, name: "staying-agent" },
    ]);
    expect(await count(db, "users")).toBe(1);
  });

  it("deleting a single token clears only that token's ids", async () => {
    const db = await newDatabase();
    await migrate(db);
    const owner = await insertUser(db, "owner");
    const gone = await insertToken(db, owner, { name: "gone-agent" });
    const kept = await insertToken(db, owner, { name: "kept-agent" });
    await insertFolder(db, owner, {
      created_by_user_id: null,
      ...byToken("created_by", gone, "gone-agent"),
      updated_by_user_id: null,
      ...byToken("updated_by", kept, "kept-agent"),
    });

    await db.sql`delete from api_tokens where id = ${gone}`;

    expect(await db.sql`select ${db.sql.unsafe(ACTOR_COLUMNS)} from folders`).toEqual([
      {
        created_by_user_id: null,
        created_by_token_id: null,
        created_by_name: "gone-agent",
        updated_by_user_id: null,
        updated_by_token_id: kept,
        updated_by_name: "kept-agent",
      },
    ]);
  });
});

describe("deleting notes", () => {
  it("removes the note's revisions and sections and nothing else", async () => {
    const db = await newDatabase();
    await migrate(db);
    const owner = await insertUser(db, "owner");
    const purged = await insertNote(db, owner, { title: "Purged" });
    const kept = await insertNote(db, owner, { title: "Kept" });
    for (const noteId of [purged, kept]) {
      for (const version of [1, 2]) {
        await insertRow(db, "note_revisions", {
          note_id: noteId,
          version,
          title: "t",
          body: "",
          change: version === 1 ? "created" : "edited",
          ...byUser("actor", owner),
        });
      }
      await db.sql`
        insert into note_sections (note_id, position, level, heading, path, start_offset,
          end_offset, subtree_end_offset, characters, approx_tokens, search)
        values (${noteId}, 0, 0, '', '(introduction)', 0, 0, 0, 0, 0, ''::tsvector)
      `;
    }
    const keptBefore = await db.sql`
      select r.id, r.version, s.position from note_revisions r
      join note_sections s using (note_id) where note_id = ${kept} order by r.version`;

    await db.sql`delete from notes where id = ${purged}`;

    expect(await db.sql`select title from notes`).toEqual([{ title: "Kept" }]);
    expect(
      await db.sql`
        select r.id, r.version, s.position from note_revisions r
        join note_sections s using (note_id) where note_id = ${kept} order by r.version`,
    ).toEqual(keptBefore);
    expect(await count(db, "note_revisions")).toBe(2);
    expect(await count(db, "note_sections")).toBe(1);
    expect(await count(db, "users")).toBe(1);
  });
});
