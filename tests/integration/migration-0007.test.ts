import { describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import { byToken, byUser, insertFolder, insertNote, insertRow, insertToken } from "./notes-harness";
import { count, insertUser } from "./two-factor-harness";

// Migration 0007 on a database that already holds notes, revisions, sections
// and folders from 0006. Rows in use keep every value and get null in the new
// trash columns. Rows already in the trash (possible only through the old
// note deletion, or written outside Hexmark for folders) get their deleting
// actor from updated_by_* and a batch of their own, so the new checks hold.

const UNCHANGED = ["users", "api_tokens", "note_revisions", "note_sections"];
const TRASH_COLUMNS = [
  "deleted_by_user_id",
  "deleted_by_token_id",
  "deleted_by_name",
  "trash_batch_id",
];
const BODY = "# Plan\n\n## Examples\n\nText with ä and 😀\n";

async function rows(db: TestDatabase, table: string) {
  return db.sql`select * from ${db.sql(table)} order by 1, 2`;
}

function withoutTrash(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !TRASH_COLUMNS.includes(key)));
}

async function seed(db: TestDatabase) {
  const owner = await insertUser(db, "owner");
  const tokenId = await insertToken(db, owner, { name: "Test" });
  const root = await insertFolder(db, owner, { name: "MCP-Test-2" });
  const child = await insertFolder(db, owner, { parent_id: root, name: "Sub" });
  // A folder with deleted_at set by hand (0006 had no way to trash folders).
  const oddFolder = await insertFolder(db, owner, {
    name: "Odd",
    deleted_at: new Date("2026-09-01T10:00:00Z"),
    updated_by_user_id: null,
    ...byToken("updated_by", tokenId, "Test"),
  });
  const plan = await insertNote(db, owner, {
    folder_id: root,
    title: "Plan",
    body: BODY,
    metadata: db.sql.json({ tags: ["a"] }),
    version: 2,
    locked_at: new Date(),
    ...byUser("locked_by", owner),
  });
  const rootNote = await insertNote(db, owner, { title: "Root", body: "" });
  // Trashed the 0006 way, once by the agent and once by a user deleted later.
  const trashedByAgent = await insertNote(db, owner, {
    folder_id: child,
    title: "Gone",
    deleted_at: new Date("2026-10-01T08:00:00Z"),
    updated_by_user_id: null,
    ...byToken("updated_by", tokenId, "Test"),
  });
  const trashedByGone = await insertNote(db, owner, {
    title: "Gone too",
    deleted_at: new Date("2026-10-02T08:00:00Z"),
    updated_by_user_id: null,
    updated_by_name: "former",
  });
  for (const [noteId, version, change, actor] of [
    [plan, 1, "created", byUser("actor", owner)],
    [plan, 2, "edited", byToken("actor", tokenId, "Test")],
    [rootNote, 1, "created", byUser("actor", owner)],
    [trashedByAgent, 1, "deleted", byToken("actor", tokenId, "Test")],
  ] as const) {
    await insertRow(db, "note_revisions", {
      note_id: noteId,
      version,
      title: "Plan",
      body: BODY,
      change,
      section_path: change === "edited" ? "Plan > Examples" : null,
      ...actor,
    });
  }
  await db.sql`
    insert into note_sections (note_id, position, level, heading, path, start_offset, end_offset,
      subtree_end_offset, characters, approx_tokens, search)
    values (${plan}, 0, 1, 'Plan', 'Plan', 0, 8, 40, 8, 2, to_tsvector('simple', 'Plan'))
  `;
  return { owner, tokenId, oddFolder, trashed: [trashedByAgent, trashedByGone] };
}

describe("migration 0007 on a database with existing notes and folders", () => {
  it("keeps every row, leaves rows in use untouched and backfills trashed ones", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(7));
    const { owner, tokenId, oddFolder, trashed } = await seed(db);
    const before = new Map<string, Record<string, unknown>[]>();
    for (const table of [...UNCHANGED, "notes", "folders"])
      before.set(table, await rows(db, table));

    await migrate(db, firstMigrations(8));

    for (const table of UNCHANGED) expect(await rows(db, table), table).toEqual(before.get(table));
    const trashedIds = new Set<unknown>([...trashed, oddFolder]);
    const batches = new Set<unknown>();
    for (const table of ["notes", "folders"]) {
      const after = await rows(db, table);
      expect(after.map(withoutTrash), table).toEqual(before.get(table));
      for (const row of after) {
        if (!trashedIds.has(row.id)) {
          for (const column of TRASH_COLUMNS) expect(row[column], `${table}.${column}`).toBeNull();
          continue;
        }
        expect(row).toMatchObject({
          deleted_by_user_id: row.updated_by_user_id,
          deleted_by_token_id: row.updated_by_token_id,
          deleted_by_name: row.updated_by_name,
        });
        expect(row.trash_batch_id).toMatch(/^[0-9a-f-]{36}$/);
        batches.add(row.trash_batch_id);
      }
    }
    expect(batches.size).toBe(3);
    const backfilled = await db.sql`
      select title, deleted_by_user_id, deleted_by_token_id, deleted_by_name from notes
      where deleted_at is not null order by title
    `;
    expect(backfilled).toEqual([
      {
        title: "Gone",
        deleted_by_user_id: null,
        deleted_by_token_id: tokenId,
        deleted_by_name: "Test",
      },
      {
        title: "Gone too",
        deleted_by_user_id: null,
        deleted_by_token_id: null,
        deleted_by_name: "former",
      },
    ]);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(8);

    await migrate(db, firstMigrations(8));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(8);
    // Trashing now needs the actor and batch along with deleted_at.
    await expect(
      db.sql`update notes set deleted_at = now() where title = 'Root'`,
    ).rejects.toMatchObject({ constraint_name: "notes_trash_pairing_check" });
    await db.sql`
      update notes set deleted_at = now(), deleted_by_user_id = ${owner}, deleted_by_name = 'owner',
        trash_batch_id = gen_random_uuid()
      where title = 'Root'
    `;
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(7));

    await migrate(db, firstMigrations(8));

    for (const table of [...UNCHANGED, "notes", "folders"]) expect(await count(db, table)).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(8);
  });
});
