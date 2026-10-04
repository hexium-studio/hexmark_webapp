import { describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import {
  byToken,
  byUser,
  insertFolder,
  insertNote,
  insertRow,
  insertToken,
  trashedBy,
} from "./notes-harness";
import { count, insertUser } from "./two-factor-harness";
import { allRows, seedEveryTable } from "./uuid-harness";

// Migration 0011 on a database that already holds rows in every table,
// tokens of both modes (one with folder and note entries), a locked note, a
// folder in the trash and a note flagged hidden by hand. Folders and notes
// get empty hidden columns; only the flagged note gets hidden_at (and the
// system as actor); notes.hidden keeps every value, now derived. Nothing
// else changes, and a server of the previous version can still insert notes.

const HIDDEN_COLUMNS = [
  "hidden_at",
  "hidden_by_user_id",
  "hidden_by_token_id",
  "hidden_by_name",
  "hide_reason",
];
const NEW_COLUMNS: Record<string, string[]> = { folders: HIDDEN_COLUMNS, notes: HIDDEN_COLUMNS };

function without(rows: unknown[] | undefined, columns: string[]) {
  return (rows ?? []).map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(([key]) => !columns.includes(key)),
    ),
  );
}

async function seed(db: TestDatabase) {
  const owner = await insertUser(db, "owner");
  await seedEveryTable(db);
  const docs = await insertFolder(db, owner, { name: "Docs" });
  await insertFolder(db, owner, { name: "Archive", ...trashedBy(owner) });
  const test = await insertToken(db, owner, {
    name: "Test",
    base_permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  const scoped = await insertToken(db, owner, {
    name: "Scoped",
    access_mode: "allow_list",
    base_permissions: null,
  });
  const plan = await insertNote(db, owner, { folder_id: docs, title: "Plan" });
  await insertNote(db, owner, {
    title: "Locked",
    locked_at: new Date("2026-10-01T12:00:00Z"),
    ...byToken("locked_by", test, "Test"),
    lock_reason: "Final",
  });
  const flagged = await insertNote(db, owner, { title: "Flagged" });
  await db.sql`update notes set hidden = true where id = ${flagged}`;
  for (const target of [
    { target_kind: "folder", folder_id: docs, permissions: ["read", "lock"] },
    { target_kind: "note", note_id: plan, permissions: ["read", "edit"] },
  ]) {
    await insertRow(db, "api_token_entries", {
      token_id: scoped,
      token_access_mode: "allow_list",
      ...target,
    });
  }
  return { owner, flagged };
}

describe("migration 0011 on a database with existing folders, notes and tokens", () => {
  it("adds empty hidden columns, carries the flag over and changes nothing else", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(11));
    const { owner, flagged } = await seed(db);
    const before = await allRows(db);
    expect(before.get("api_token_entries")).toHaveLength(2);

    const started = new Date();
    await migrate(db, firstMigrations(12));

    const after = await allRows(db);
    for (const [table, rows] of before) {
      const added = NEW_COLUMNS[table] ?? [];
      expect(without(after.get(table), added), table).toEqual(without(rows, []));
    }
    for (const [table, rows] of [
      ["folders", await db.sql`select * from folders`],
      ["notes", await db.sql`select * from notes where id <> ${flagged}`],
    ] as const) {
      expect(rows.length, table).toBeGreaterThan(1);
      for (const row of rows) {
        for (const column of HIDDEN_COLUMNS) expect(row[column], column).toBeNull();
        if (table === "notes") expect(row.hidden).toBe(false);
      }
    }
    const [carried] = await db.sql`select * from notes where id = ${flagged}`;
    expect(carried).toMatchObject({
      hidden: true,
      hidden_by_user_id: null,
      hidden_by_token_id: null,
      hidden_by_name: "System",
      hide_reason: null,
    });
    expect(carried?.hidden_at.getTime()).toBeGreaterThanOrEqual(started.getTime() - 1000);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(12);

    // Again: nothing to do.
    await migrate(db, firstMigrations(12));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(12);
    expect(await allRows(db)).toEqual(after);

    // A server of the previous version names every column it knows, hidden
    // included, with "default" for those it does not set.
    const [inserted] = await db.sql`
      insert into notes (title, body, created_by_user_id, created_by_name, updated_by_user_id,
        updated_by_name, hidden)
      values ('Old server', '', ${owner}, 'owner', ${owner}, 'owner', default)
      returning hidden, hidden_at
    `;
    expect(inserted).toEqual({ hidden: false, hidden_at: null });
    // The previous permission sets are still accepted.
    await insertToken(db, owner, { name: "Later", base_permissions: ["read", "lock"] });
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(11));

    await migrate(db, firstMigrations(12));

    expect(await count(db, "notes")).toBe(0);
    expect(await count(db, "folders")).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(12);
  });

  it("hides with an actor on the migrated schema", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(12));
    const owner = await insertUser(db, "owner");
    const id = await insertNote(db, owner, {
      hidden_at: new Date(),
      ...byUser("hidden_by", owner),
    });
    const [row] = await db.sql`select hidden, hidden_by_name from notes where id = ${id}`;
    expect(row).toEqual({ hidden: true, hidden_by_name: "owner" });
  });
});
