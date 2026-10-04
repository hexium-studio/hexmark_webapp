import { describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import {
  byToken,
  byUser,
  insertFolder,
  insertNote,
  insertToken,
  legacyTokenRow,
  trashedBy,
  UNKNOWN_ID,
} from "./notes-harness";
import { count, insertUser, tryInsert } from "./two-factor-harness";
import { allRows, seedEveryTable } from "./uuid-harness";

// Migration 0010 on a database that already holds rows in every table and
// API tokens of every kind 0009 allows. Every token gets an access mode from
// its folder scope (none: deny_list with its permissions as base set; a
// scope: allow_list with one folder entry per scoped folder); the legacy
// columns keep their values. Folders and notes get empty lock columns
// (an existing note lock stays, without a reason). Nothing else changes.

const NEW_COLUMNS: Record<string, string[]> = {
  api_tokens: ["access_mode", "base_permissions"],
  folders: [
    "locked_at",
    "locked_by_user_id",
    "locked_by_token_id",
    "locked_by_name",
    "lock_reason",
  ],
  notes: ["lock_reason"],
};
const OWNER_SET = ["read", "search", "create", "edit", "move", "delete"];

function without(rows: unknown[] | undefined, columns: string[]) {
  return (rows ?? []).map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(([key]) => !columns.includes(key)),
    ),
  );
}

async function seed(db: TestDatabase) {
  const owner = await insertUser(db, "owner");
  // One row in every table, for another user.
  await seedEveryTable(db);
  const agentTarget = await insertToken(db, owner, { name: "Target" });
  const docs = await insertFolder(db, owner, { name: "Docs" });
  const team = await insertFolder(db, owner, { name: "Team", parent_id: docs });
  const archive = await insertFolder(db, owner, { name: "Archive", ...trashedBy(owner) });
  const other = await insertFolder(db, owner, { name: "Other" });
  await insertNote(db, owner, {
    folder_id: docs,
    title: "Locked",
    locked_at: new Date("2026-09-30T12:00:00Z"),
    ...byToken("locked_by", agentTarget, "Target"),
  });
  await insertNote(db, owner, {
    title: "Old lock",
    locked_at: new Date(),
    ...byUser("locked_by", owner),
  });
  const tokens = {
    whole: await insertToken(db, owner, { name: "Test", permissions: OWNER_SET }),
    scoped: await insertToken(db, owner, {
      name: "Scoped",
      permissions: ["read", "edit", "lock"],
      folder_scope: [team, archive],
    }),
    revoked: await insertToken(db, owner, {
      name: "Revoked",
      permissions: ["read"],
      folder_scope: [other],
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
    }),
    // A folder listed twice and one deleted for good since (the scope had
    // no foreign key).
    odd: await insertToken(db, owner, {
      name: "Odd",
      permissions: ["search"],
      folder_scope: [docs, UNKNOWN_ID, docs],
    }),
    revokedWhole: await insertToken(db, owner, { name: "Gone", revoked_at: new Date() }),
  };
  return { owner, tokens, folders: { docs, team, archive, other } };
}

describe("migration 0010 on a database with existing tokens, folders and notes", () => {
  it("converts every token and changes nothing else", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(10));
    const { owner, folders } = await seed(db);
    const before = await allRows(db);
    expect(before.has("api_token_entries")).toBe(false);

    await migrate(db, firstMigrations(11));

    const after = await allRows(db);
    for (const [table, rows] of before) {
      const added = NEW_COLUMNS[table] ?? [];
      expect(without(after.get(table), added), table).toEqual(without(rows, []));
    }
    for (const table of ["folders", "notes"]) {
      for (const row of after.get(table) as Record<string, unknown>[]) {
        for (const column of NEW_COLUMNS[table] ?? []) expect(row[column], column).toBeNull();
      }
    }

    const modes = await db.sql`
      select name, access_mode, base_permissions, permissions, folder_scope is null as whole
      from api_tokens where user_id = ${owner} order by name
    `;
    expect(modes.map((t) => [t.name, t.access_mode, t.base_permissions])).toEqual([
      ["Gone", "deny_list", ["read", "search"]],
      ["Odd", "allow_list", null],
      ["Revoked", "allow_list", null],
      ["Scoped", "allow_list", null],
      ["Target", "deny_list", ["read", "search"]],
      ["Test", "deny_list", OWNER_SET],
    ]);
    const entries = await db.sql`
      select t.name, e.token_access_mode, e.target_kind, e.folder_id, e.note_id, e.permissions,
        e.created_at = t.created_at as created_with_token
      from api_token_entries e join api_tokens t on t.id = e.token_id
      order by t.name, e.folder_id
    `;
    const entry = (name: string, folderId: string, permissions: string[]) => ({
      name,
      token_access_mode: "allow_list",
      target_kind: "folder",
      folder_id: folderId,
      note_id: null,
      permissions,
      created_with_token: true,
    });
    const scopedEntries = [
      entry("Scoped", folders.team, ["read", "edit", "lock"]),
      entry("Scoped", folders.archive, ["read", "edit", "lock"]),
    ].sort((a, b) => (a.folder_id < b.folder_id ? -1 : 1));
    expect(entries).toEqual([
      entry("Odd", folders.docs, ["search"]),
      entry("Revoked", folders.other, ["read"]),
      ...scopedEntries,
    ]);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(11);

    await migrate(db, firstMigrations(11));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(11);
    expect(await count(db, "api_token_entries")).toBe(4);
    // A server of the previous version cannot create tokens any more (it
    // sets no mode), but its existing tokens keep their legacy columns.
    await expect(tryInsert(db, "api_tokens", legacyTokenRow(owner))).rejects.toMatchObject({
      code: "23502",
      column_name: "access_mode",
    });
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(10));

    await migrate(db, firstMigrations(11));

    expect(await count(db, "api_tokens")).toBe(0);
    expect(await count(db, "api_token_entries")).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(11);
  });
});
