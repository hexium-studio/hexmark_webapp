import { describe, expect, it } from "vitest";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import {
  byToken,
  byUser,
  insertFolder,
  insertNote,
  insertRow,
  insertToken,
  UNKNOWN_ID,
} from "./notes-harness";
import { count, insertUser } from "./two-factor-harness";

// Migration 0006 on a database that already holds notes and revisions from
// 0005: it only adds the nullable column note_revisions.section_path. Every
// existing row keeps every value, and every existing revision gets null -
// nothing recorded which section those changes touched.

const TABLES = ["users", "api_tokens", "folders", "notes", "note_revisions", "note_sections"];

describe("migration 0006 on a database with existing revisions", () => {
  it("keeps every row unchanged and leaves section_path null", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(6));
    const userId = await insertUser(db, "owner");
    const tokenId = await insertToken(db, userId, { revoked_at: new Date() });
    const folderId = await insertFolder(db, userId, { name: "MCP-Test" });
    const noteId = await insertNote(db, userId, {
      folder_id: folderId,
      title: "Plan",
      body: "# Plan\n\n## Examples\n\nText with ä and 😀\n",
      metadata: db.sql.json({ tags: ["a"], nested: { n: 1 } }),
      version: 6,
    });
    const emptyNote = await insertNote(db, userId);
    const revisions = [
      { change: "created", body: "", ...byUser("actor", userId), reason: null },
      { change: "edited", body: "# Plan\n", ...byToken("actor", tokenId), reason: "Agent edit" },
      { change: "renamed", title: "Old plan", ...byUser("actor", userId), reason: "" },
      // A deleted actor: both ids null, only the stored name remains.
      { change: "moved", folder_id: UNKNOWN_ID, actor_name: "gone-agent" },
      { change: "deleted", ...byUser("actor", userId) },
      { change: "restored", ...byUser("actor", userId), metadata: db.sql.json({ k: "v" }) },
    ];
    for (const [index, values] of revisions.entries()) {
      await insertRow(db, "note_revisions", {
        note_id: noteId,
        version: index + 1,
        title: "Plan",
        body: "# Plan\n\n## Examples\n\nText with ä and 😀\n",
        ...values,
      });
    }
    await insertRow(db, "note_revisions", {
      note_id: emptyNote,
      version: 1,
      title: "Empty",
      body: "",
      change: "created",
      ...byUser("actor", userId),
    });
    const before = new Map<string, unknown>();
    for (const table of TABLES) {
      before.set(table, await db.sql`select * from ${db.sql(table)} order by 1`);
    }
    expect(await count(db, "note_revisions")).toBe(7);

    await migrate(db, firstMigrations(7));

    for (const table of TABLES) {
      const rows = await db.sql`select * from ${db.sql(table)} order by 1`;
      if (table !== "note_revisions") {
        expect(rows, table).toEqual(before.get(table));
        continue;
      }
      expect(rows.map(({ section_path: _, ...rest }) => rest)).toEqual(before.get(table));
      expect(rows.map((row) => row.section_path)).toEqual(Array(7).fill(null));
    }
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(7);

    await migrate(db, firstMigrations(7));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(7);

    // A section-level edit can now be recorded next to the old revisions.
    await insertRow(db, "note_revisions", {
      note_id: noteId,
      version: 7,
      title: "Plan",
      body: "# Plan\n",
      change: "edited",
      section_path: "Plan > Examples",
      ...byToken("actor", tokenId),
    });
    expect(await count(db, "note_revisions")).toBe(8);
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(6));

    await migrate(db, firstMigrations(7));

    for (const table of TABLES) expect(await count(db, table), table).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(7);
  });
});
