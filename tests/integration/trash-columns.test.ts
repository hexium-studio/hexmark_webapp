import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  byToken,
  byUser,
  expectAccepted,
  expectRefused,
  insertRow,
  insertToken,
  noteRow,
  trashedBy,
} from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The trash columns of migration 0007 on notes and folders: who moved a row
// to the trash and its batch are set exactly when deleted_at is, with at
// most one actor id. Both directions: what must pass and what must not.

let db: TestDatabase;
let userId: string;
let tokenId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  tokenId = await insertToken(db, userId, { name: "agent" });
});

const TABLES = {
  folders: (values: Record<string, unknown>) => ({
    name: `folder-${randomUUID()}`,
    ...byUser("created_by", userId),
    ...byUser("updated_by", userId),
    ...values,
  }),
  notes: (values: Record<string, unknown>) => noteRow(userId, values),
};

for (const [table, row] of Object.entries(TABLES)) {
  const pairing = `${table}_trash_pairing_check`;

  describe(`${table}: trash columns`, () => {
    it("accepts a row in use and trashed rows by a human, an agent or a cleared actor", async () => {
      await expectAccepted(db, table, row({}));
      await expectAccepted(db, table, row(trashedBy(userId)));
      await expectAccepted(
        db,
        table,
        row({
          deleted_at: new Date(),
          ...byToken("deleted_by", tokenId),
          trash_batch_id: randomUUID(),
        }),
      );
      // The deleting user or token was deleted later: only the name is left.
      await expectAccepted(
        db,
        table,
        row({ deleted_at: new Date(), deleted_by_name: "gone", trash_batch_id: randomUUID() }),
      );
    });

    it("refuses a trashed row without actor name or batch", async () => {
      const at = new Date();
      const batch = randomUUID();
      await expectRefused(db, table, row({ deleted_at: at }), pairing);
      await expectRefused(db, table, row({ deleted_at: at, trash_batch_id: batch }), pairing);
      await expectRefused(
        db,
        table,
        row({ deleted_at: at, ...byUser("deleted_by", userId) }),
        pairing,
      );
      await expectRefused(
        db,
        table,
        row({ deleted_at: at, deleted_by_user_id: userId, trash_batch_id: batch }),
        pairing,
      );
    });

    it("refuses trash columns on a row in use", async () => {
      await expectRefused(db, table, row({ trash_batch_id: randomUUID() }), pairing);
      await expectRefused(db, table, row({ deleted_by_name: "owner" }), pairing);
      await expectRefused(db, table, row({ deleted_by_user_id: userId }), pairing);
      await expectRefused(db, table, row({ deleted_by_token_id: tokenId }), pairing);
    });

    it("refuses two actor ids and a name outside 1-64 characters", async () => {
      await expectRefused(
        db,
        table,
        row({ ...trashedBy(userId), deleted_by_token_id: tokenId }),
        `${table}_deleted_by_single_id_check`,
      );
      for (const name of ["", "x".repeat(65)]) {
        await expectRefused(
          db,
          table,
          row(trashedBy(userId, randomUUID(), name)),
          `${table}_deleted_by_name_length_check`,
        );
      }
      await expectAccepted(db, table, row(trashedBy(userId, randomUUID(), "x".repeat(64))));
    });

    it("restores only when every trash column is cleared together", async () => {
      const { id } = await insertRow(db, table, row(trashedBy(userId)));
      await expect(
        db.sql`update ${db.sql(table)} set deleted_at = null where id = ${id as string}`,
      ).rejects.toMatchObject({ constraint_name: pairing });
      await db.sql`
        update ${db.sql(table)} set deleted_at = null, deleted_by_user_id = null,
          deleted_by_token_id = null, deleted_by_name = null, trash_batch_id = null
        where id = ${id as string}
      `;
    });

    it("keeps the name when the deleting user is deleted", async () => {
      const leaving = await insertUser(db, `leaving-${table}`);
      const { id } = await insertRow(db, table, row(trashedBy(leaving, randomUUID(), "leaving")));
      await db.sql`delete from users where id = ${leaving}`;
      const [after] = await db.sql`
        select deleted_by_user_id, deleted_by_name, deleted_at is not null as trashed
        from ${db.sql(table)} where id = ${id as string}
      `;
      expect(after).toEqual({
        deleted_by_user_id: null,
        deleted_by_name: "leaving",
        trashed: true,
      });
    });
  });
}

describe("trash indexes", () => {
  it("cover only rows in the trash", async () => {
    const rows = await db.sql`
      select indexname, indexdef from pg_indexes
      where indexname in ('notes_deleted_at_idx', 'notes_trash_batch_id_idx',
        'folders_deleted_at_idx', 'folders_trash_batch_id_idx')
      order by indexname
    `;
    expect(rows.map((r) => r.indexname)).toEqual([
      "folders_deleted_at_idx",
      "folders_trash_batch_id_idx",
      "notes_deleted_at_idx",
      "notes_trash_batch_id_idx",
    ]);
    for (const r of rows) expect(r.indexdef).toMatch(/WHERE \(\w+ IS NOT NULL\)/);
  });
});
