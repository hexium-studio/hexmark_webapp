import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  byToken,
  byUser,
  expectAccepted,
  expectRefused,
  insertFolder,
  insertNote,
  insertToken,
  noteRow,
} from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The lock columns of folders and notes (migration 0010, lock-columns.ts):
// locked_at, the locked_by actor triple and lock_reason, with the same rules
// for both tables.

let db: TestDatabase;
let userId: string;
let tokenId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  tokenId = await insertToken(db, userId, { name: "agent" });
});

const TABLES = ["folders", "notes"] as const;
type Table = (typeof TABLES)[number];

function row(table: Table, values: Record<string, unknown>) {
  if (table === "notes") return noteRow(userId, values);
  return {
    name: `folder-${Math.random().toString(36).slice(2, 8)}`,
    ...byUser("created_by", userId),
    ...byUser("updated_by", userId),
    ...values,
  };
}

const locked = (values: Record<string, unknown> = {}) => ({
  locked_at: new Date(),
  ...byUser("locked_by", userId),
  ...values,
});

describe.each(TABLES)("%s: lock columns", (table) => {
  const accepted = (values: Record<string, unknown>) =>
    expectAccepted(db, table, row(table, values));
  const refused = (values: Record<string, unknown>, check: string) =>
    expectRefused(db, table, row(table, values), `${table}_${check}`);

  it("accepts an unlocked row and leaves every lock column null", async () => {
    const id = table === "notes" ? await insertNote(db, userId) : await insertFolder(db, userId);
    const [stored] = await db.sql`
      select locked_at, locked_by_user_id, locked_by_token_id, locked_by_name, lock_reason
      from ${db.sql(table)} where id = ${id}
    `;
    expect(stored).toEqual({
      locked_at: null,
      locked_by_user_id: null,
      locked_by_token_id: null,
      locked_by_name: null,
      lock_reason: null,
    });
  });

  it("accepts a lock by a human or an agent, with or without a reason", async () => {
    await accepted(locked());
    await accepted(locked({ lock_reason: "Release notes are final" }));
    await accepted({ locked_at: new Date(), ...byToken("locked_by", tokenId), lock_reason: "x" });
    await accepted(locked({ lock_reason: "r".repeat(500) }));
    await accepted(locked({ lock_reason: "  padded  " }));
    // The locking user or token deleted since: the name stays.
    await accepted({ locked_at: new Date(), locked_by_name: "former" });
  });

  it("refuses a lock without a name, and lock data without locked_at", async () => {
    await refused({ locked_at: new Date() }, "locked_by_pairing_check");
    await refused(byUser("locked_by", userId), "locked_by_pairing_check");
    await refused({ locked_by_token_id: tokenId }, "locked_by_pairing_check");
    await refused({ lock_reason: "no lock" }, "lock_reason_check");
  });

  it("refuses both ids and a name outside 1-64 characters", async () => {
    await refused(locked({ locked_by_token_id: tokenId }), "locked_by_single_id_check");
    for (const name of ["", "n".repeat(65)]) {
      await refused(locked({ locked_by_name: name }), "locked_by_name_length_check");
    }
  });

  it("refuses an empty, blank or too long reason", async () => {
    for (const reason of ["", " ", "\n\t ", "r".repeat(501)]) {
      await refused(locked({ lock_reason: reason }), "lock_reason_check");
    }
  });

  it("keeps the lock when the locking user is deleted", async () => {
    const leaving = await insertUser(db, `leaving-${table}`);
    const [stored] = await db.sql`
      insert into ${db.sql(table)} ${db.sql(
        row(table, {
          locked_at: new Date(),
          ...byUser("locked_by", leaving, "leaving"),
          lock_reason: "Kept",
        }),
      )} returning id
    `;
    await db.sql`delete from users where id = ${leaving}`;
    const [after] = await db.sql`
      select locked_at is not null as locked, locked_by_user_id, locked_by_name, lock_reason
      from ${db.sql(table)} where id = ${stored?.id}
    `;
    expect(after).toEqual({
      locked: true,
      locked_by_user_id: null,
      locked_by_name: "leaving",
      lock_reason: "Kept",
    });
  });
});
