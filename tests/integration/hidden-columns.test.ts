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
import { insertUser, tryInsert } from "./two-factor-harness";

// The hidden columns of folders and notes (migration 0011,
// hidden-columns.ts): hidden_at, the hidden_by actor triple and hide_reason,
// with the same rules for both tables, independent of the lock columns;
// and notes.hidden, derived from hidden_at.

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

const hidden = (values: Record<string, unknown> = {}) => ({
  hidden_at: new Date(),
  ...byUser("hidden_by", userId),
  ...values,
});

describe.each(TABLES)("%s: hidden columns", (table) => {
  const accepted = (values: Record<string, unknown>) =>
    expectAccepted(db, table, row(table, values));
  const refused = (values: Record<string, unknown>, check: string) =>
    expectRefused(db, table, row(table, values), `${table}_${check}`);

  it("leaves every hidden column null on a row that is not hidden", async () => {
    const id = table === "notes" ? await insertNote(db, userId) : await insertFolder(db, userId);
    const [stored] = await db.sql`
      select hidden_at, hidden_by_user_id, hidden_by_token_id, hidden_by_name, hide_reason
      from ${db.sql(table)} where id = ${id}
    `;
    expect(stored).toEqual({
      hidden_at: null,
      hidden_by_user_id: null,
      hidden_by_token_id: null,
      hidden_by_name: null,
      hide_reason: null,
    });
  });

  it("accepts hiding by a human or an agent, with or without a reason", async () => {
    await accepted(hidden());
    await accepted(hidden({ hide_reason: "Personal data" }));
    await accepted({ hidden_at: new Date(), ...byToken("hidden_by", tokenId), hide_reason: "x" });
    await accepted(hidden({ hide_reason: "r".repeat(500) }));
    await accepted(hidden({ hide_reason: "  padded  " }));
    // The hiding user or token deleted since: the name stays.
    await accepted({ hidden_at: new Date(), hidden_by_name: "former" });
    // Hidden and locked at once, by different actors.
    await accepted(
      hidden({ locked_at: new Date(), ...byToken("locked_by", tokenId), lock_reason: "x" }),
    );
  });

  it("refuses hiding without a name, and hidden data without hidden_at", async () => {
    await refused({ hidden_at: new Date() }, "hidden_by_pairing_check");
    await refused(byUser("hidden_by", userId), "hidden_by_pairing_check");
    await refused({ hidden_by_token_id: tokenId }, "hidden_by_pairing_check");
    await refused({ hide_reason: "not hidden" }, "hide_reason_check");
    // The lock does not stand in for it, nor the other way round.
    await refused({ locked_at: new Date(), hidden_by_name: "owner" }, "hidden_by_pairing_check");
    await refused(hidden({ lock_reason: "x" }), "lock_reason_check");
  });

  it("refuses both ids and a name outside 1-64 characters", async () => {
    await refused(hidden({ hidden_by_token_id: tokenId }), "hidden_by_single_id_check");
    for (const name of ["", "n".repeat(65)]) {
      await refused(hidden({ hidden_by_name: name }), "hidden_by_name_length_check");
    }
  });

  it("refuses an empty, blank or too long reason", async () => {
    for (const reason of ["", " ", "\n\t ", "r".repeat(501)]) {
      await refused(hidden({ hide_reason: reason }), "hide_reason_check");
    }
  });

  it("keeps the hidden state when the hiding user or token is deleted", async () => {
    const leaving = await insertUser(db, `leaving-${table}`);
    const agent = await insertToken(db, leaving, { name: "leaving-agent" });
    const ids: string[] = [];
    for (const actor of [byUser("hidden_by", leaving, "leaving"), byToken("hidden_by", agent)]) {
      const [stored] = await db.sql`
        insert into ${db.sql(table)} ${db.sql(
          row(table, { hidden_at: new Date(), ...actor, hide_reason: "Kept" }),
        )} returning id
      `;
      ids.push(stored?.id);
    }
    await db.sql`delete from users where id = ${leaving}`;
    const after = await db.sql`
      select hidden_at is not null as is_hidden, hidden_by_user_id, hidden_by_token_id,
        hidden_by_name, hide_reason
      from ${db.sql(table)} where id in ${db.sql(ids)} order by hidden_by_name
    `;
    const kept = (name: string) => ({
      is_hidden: true,
      hidden_by_user_id: null,
      hidden_by_token_id: null,
      hidden_by_name: name,
      hide_reason: "Kept",
    });
    expect(after).toEqual([kept("agent"), kept("leaving")]);
  });

  it("lists hidden rows through a partial index", async () => {
    const [index] = await db.sql`
      select indexdef from pg_indexes where indexname = ${`${table}_hidden_at_idx`}
    `;
    expect(index?.indexdef).toContain("WHERE (hidden_at IS NOT NULL)");
  });
});

describe("notes.hidden", () => {
  it("follows hidden_at and cannot be written", async () => {
    const id = await insertNote(db, userId);
    const state = async () =>
      (await db.sql`select hidden from notes where id = ${id}`)[0]?.hidden as boolean;
    expect(await state()).toBe(false);
    await db.sql`update notes set hidden_at = now(), hidden_by_name = 'owner' where id = ${id}`;
    expect(await state()).toBe(true);
    await db.sql`
      update notes set hidden_at = null, hidden_by_name = null, hidden_by_user_id = null
      where id = ${id}
    `;
    expect(await state()).toBe(false);
    await expect(tryInsert(db, "notes", noteRow(userId, { hidden: true }))).rejects.toMatchObject({
      code: "428C9",
    });
    await expect(db.sql`update notes set hidden = true where id = ${id}`).rejects.toMatchObject({
      code: "428C9",
    });
  });
});
