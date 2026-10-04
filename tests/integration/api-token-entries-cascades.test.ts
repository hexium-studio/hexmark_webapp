import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { insertFolder, insertNote, insertRow, insertToken, trashedBy } from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// api_token_entries (migration 0010): what happens to entries when their
// token or target goes away. Rules of the rows: api-token-entries-table.test.ts.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const allowList = { access_mode: "allow_list", base_permissions: null };

const entry = (tokenId: string, target: { folder_id: string } | { note_id: string }) => ({
  token_id: tokenId,
  token_access_mode: "allow_list",
  target_kind: "folder_id" in target ? "folder" : "note",
  permissions: ["read"],
  ...target,
});

const entriesOf = async (tokenId: string) =>
  (await db.sql`select id from api_token_entries where token_id = ${tokenId}`).length;

describe("api_token_entries: cascades", () => {
  it("removes the entries of a deleted token, keeps those of others", async () => {
    const gone = await insertToken(db, userId, allowList);
    const kept = await insertToken(db, userId, allowList);
    const folder = await insertFolder(db, userId);
    await insertRow(db, "api_token_entries", entry(gone, { folder_id: folder }));
    await insertRow(db, "api_token_entries", entry(kept, { folder_id: folder }));
    await db.sql`delete from api_tokens where id = ${gone}`;
    expect(await entriesOf(gone)).toBe(0);
    expect(await entriesOf(kept)).toBe(1);
  });

  it("keeps entries of trashed targets and removes those deleted for good", async () => {
    const tokenId = await insertToken(db, userId, allowList);
    const folder = await insertFolder(db, userId);
    const note = await insertNote(db, userId, { folder_id: folder });
    const keptFolder = await insertFolder(db, userId);
    await insertRow(db, "api_token_entries", entry(tokenId, { folder_id: folder }));
    await insertRow(db, "api_token_entries", entry(tokenId, { note_id: note }));
    await insertRow(db, "api_token_entries", entry(tokenId, { folder_id: keptFolder }));
    const batch = trashedBy(userId);
    await db.sql`update folders set ${db.sql(batch)} where id = ${folder}`;
    await db.sql`update notes set ${db.sql(batch)} where id = ${note}`;
    expect(await entriesOf(tokenId)).toBe(3);

    await db.sql`delete from notes where id = ${note}`;
    expect(await entriesOf(tokenId)).toBe(2);
    await db.sql`delete from folders where id = ${folder}`;
    const left = await db.sql`select folder_id from api_token_entries where token_id = ${tokenId}`;
    expect(left).toEqual([{ folder_id: keptFolder }]);
  });

  it("has indexes on folder_id and note_id for the cascades", async () => {
    const indexes = await db.sql`
      select indexname from pg_indexes where tablename = 'api_token_entries' order by 1
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "api_token_entries_folder_id_idx",
      "api_token_entries_note_id_idx",
      "api_token_entries_pkey",
      "api_token_entries_token_id_folder_id_unique",
      "api_token_entries_token_id_note_id_unique",
    ]);
  });
});
