import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_MIGRATIONS } from "../support/paths";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import { count } from "./two-factor-harness";
import { allRows, ID_TABLES, seedEveryTable, versionsOf } from "./uuid-harness";

// Migration 0008 on a database that already holds rows in every table:
// existing version 4 ids and every other value stay exactly as they were,
// only the id defaults switch to uuidv7(). New rows, also those pointing at
// old version 4 rows, get version 7 ids.

const ALL_V4 = Object.fromEntries(ID_TABLES.map((table) => [table, 4]));
const ALL_V7 = Object.fromEntries(ID_TABLES.map((table) => [table, 7]));

async function idDefaults(db: Awaited<ReturnType<typeof newDatabase>>) {
  return db.sql`
    select table_name, column_name, column_default from information_schema.columns
    where table_schema = 'public' and column_default ilike '%uuid%'
    order by table_name, column_name
  `;
}

describe("migration 0008 on a database with existing rows", () => {
  it("keeps every row and id, and gives new rows version 7 ids", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(8));
    const old = await seedEveryTable(db);
    // A note in the trash, as 0007 writes it.
    await db.sql`
      update notes set deleted_at = now(), deleted_by_user_id = updated_by_user_id,
        deleted_by_name = updated_by_name, trash_batch_id = gen_random_uuid()
      where id = ${old.notes}
    `;
    expect(await versionsOf(db, old)).toEqual(ALL_V4);
    const before = await allRows(db);

    await migrate(db, firstMigrations(9));

    expect(await allRows(db)).toEqual(before);
    const defaults = await idDefaults(db);
    expect(defaults.map((row) => row.table_name)).toEqual([...ID_TABLES].sort());
    for (const row of defaults) {
      expect(row, row.table_name).toMatchObject({ column_name: "id", column_default: "uuidv7()" });
    }

    // New rows next to and below the old ones: owned by the old user, in the
    // old folder, a revision of the old note.
    const fresh = await seedEveryTable(db, {
      owner: old.users,
      parent: old.folders,
      note: old.notes,
    });
    expect(await versionsOf(db, fresh)).toEqual(ALL_V7);
    expect(await versionsOf(db, old)).toEqual(ALL_V4);
    const [joined] = await db.sql`
      select f.parent_id, n.folder_id, r.note_id, s.user_id from folders f
      join notes n on n.folder_id = f.id
      join note_revisions r on r.id = ${fresh.note_revisions}
      join sessions s on s.id = ${fresh.sessions}
      where f.id = ${fresh.folders}
    `;
    expect(joined).toEqual({
      parent_id: old.folders,
      folder_id: fresh.folders,
      note_id: old.notes,
      user_id: old.users,
    });
    // An explicitly given version 4 id is still accepted.
    const [given] = await db.sql`
      insert into recovery_codes (id, user_id, code_hash)
      values (gen_random_uuid(), ${old.users}, ${"a".repeat(64)})
      returning uuid_extract_version(id) as v
    `;
    expect(given?.v).toBe(4);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(9);

    await migrate(db, firstMigrations(9));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(9);
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(8));

    await migrate(db, firstMigrations(9));

    for (const table of ID_TABLES) expect(await count(db, table), table).toBe(0);
    expect((await idDefaults(db)).every((row) => row.column_default === "uuidv7()")).toBe(true);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(9);
  });
});

describe("the PostgreSQL version check of migration 0008", () => {
  const statements = readFileSync(join(SERVER_MIGRATIONS, "0008_uuid_v7.sql"), "utf8").split(
    "--> statement-breakpoint",
  );
  const check = statements.find((statement) => statement.includes("server_version_num")) ?? "";

  it("comes first and passes on PostgreSQL 18", async () => {
    expect(statements[0]).toBe(check);
    expect(check).toContain("< 180000");
    const db = await newDatabase();
    await db.sql.unsafe(check);
  });

  it("stops the migration with a clear message on an older server", async () => {
    const db = await newDatabase();
    // The same check with the bar above this server's version.
    await expect(db.sql.unsafe(check.replace("< 180000", "< 9990000"))).rejects.toThrow(
      /^Hexmark needs PostgreSQL 18 or newer, this server runs 18\./,
    );
  });
});
