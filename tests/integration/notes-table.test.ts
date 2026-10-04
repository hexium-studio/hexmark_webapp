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
  trashedBy,
} from "./notes-harness";
import { insertUser, tryInsert } from "./two-factor-harness";

// The notes table (migration 0005): the rules the database enforces on its
// own, and the search column PostgreSQL keeps up to date.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const note = (values: Record<string, unknown> = {}) => noteRow(userId, values);

describe("notes: defaults and limits", () => {
  it("fills version, metadata, hidden, timestamps and leaves trash and lock empty", async () => {
    const [row] = await db.sql`insert into notes ${db.sql(note())} returning *`;
    expect(row).toMatchObject({
      version: 1,
      metadata: {},
      hidden: false,
      deleted_at: null,
      locked_at: null,
      locked_by_name: null,
    });
    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.updated_at).toBeInstanceOf(Date);
  });

  it("accepts titles of 1 and 200 characters and a body of exactly 1 MB", async () => {
    await expectAccepted(db, "notes", note({ title: "a" }));
    await expectAccepted(db, "notes", note({ title: "ü".repeat(200) }));
    await expectAccepted(db, "notes", note({ body: "x".repeat(1_048_576) }));
  });

  it("refuses an empty or too long title and a body over 1 MB (counted in bytes)", async () => {
    await expectRefused(db, "notes", note({ title: "" }), "notes_title_length_check");
    await expectRefused(db, "notes", note({ title: "x".repeat(201) }), "notes_title_length_check");
    await expectRefused(
      db,
      "notes",
      note({ body: "x".repeat(1_048_577) }),
      "notes_body_size_check",
    );
    // 524,289 two-byte characters: under the limit in characters, over it in bytes.
    await expectRefused(db, "notes", note({ body: "ü".repeat(524_289) }), "notes_body_size_check");
  });

  it("refuses metadata that is not an object and a version below 1", async () => {
    await expectAccepted(db, "notes", note({ metadata: db.sql.json({ tags: ["a"], n: 1 }) }));
    for (const metadata of [[], "text", 1, true]) {
      await expectRefused(
        db,
        "notes",
        note({ metadata: db.sql.json(metadata) }),
        "notes_metadata_object_check",
      );
    }
    await expectRefused(db, "notes", note({ version: 0 }), "notes_version_check");
    await expectAccepted(db, "notes", note({ version: 7 }));
  });

  it("refuses writing the search column", async () => {
    await expect(tryInsert(db, "notes", note({ search: "x" }))).rejects.toMatchObject({
      code: "428C9",
    });
  });
});

describe("notes: unique titles within a folder", () => {
  it("refuses the same title in another case in the same folder and at root level", async () => {
    const folderId = await insertFolder(db, userId);
    await insertNote(db, userId, { folder_id: folderId, title: "Plan" });
    await insertNote(db, userId, { title: "Root Plan" });
    await expectRefused(
      db,
      "notes",
      note({ folder_id: folderId, title: "PLAN" }),
      "notes_folder_id_title_unique",
    );
    await expectRefused(db, "notes", note({ title: "root plan" }), "notes_root_title_unique");
  });

  it("allows the same title in another folder, at root level and next to trashed notes", async () => {
    const a = await insertFolder(db, userId);
    const b = await insertFolder(db, userId);
    await insertNote(db, userId, { folder_id: a, title: "Same" });
    await expectAccepted(db, "notes", note({ folder_id: b, title: "Same" }));
    await expectAccepted(db, "notes", note({ title: "Same" }));

    await insertNote(db, userId, { folder_id: a, title: "Gone", ...trashedBy(userId) });
    await insertNote(db, userId, { title: "Gone", ...trashedBy(userId) });
    await insertNote(db, userId, { title: "Gone", ...trashedBy(userId) });
    await expectAccepted(db, "notes", note({ folder_id: a, title: "gone" }));
    await expectAccepted(db, "notes", note({ title: "GONE" }));
  });
});

describe("notes: lock", () => {
  it("accepts an unlocked note and a lock by a human or an agent", async () => {
    const tokenId = await insertToken(db, userId);
    await expectAccepted(db, "notes", note());
    await expectAccepted(
      db,
      "notes",
      note({ locked_at: new Date(), ...byUser("locked_by", userId) }),
    );
    await expectAccepted(
      db,
      "notes",
      note({ locked_at: new Date(), ...byToken("locked_by", tokenId) }),
    );
    // Locker deleted later: only the name is left.
    await expectAccepted(db, "notes", note({ locked_at: new Date(), locked_by_name: "gone" }));
  });

  it("refuses a lock without a name, and lock details without a lock", async () => {
    const tokenId = await insertToken(db, userId);
    const refused = "notes_locked_by_pairing_check";
    await expectRefused(db, "notes", note({ locked_at: new Date() }), refused);
    await expectRefused(db, "notes", note({ locked_by_name: "owner" }), refused);
    await expectRefused(db, "notes", note({ locked_by_user_id: userId }), refused);
    await expectRefused(db, "notes", note({ locked_by_token_id: tokenId }), refused);
    await expectRefused(
      db,
      "notes",
      note({ locked_at: new Date(), ...byUser("locked_by", userId), locked_by_token_id: tokenId }),
      "notes_locked_by_single_id_check",
    );
  });
});

describe("notes: search column", () => {
  async function search(query: string): Promise<string[]> {
    const rows = await db.sql`
      select title from notes
      where search @@ websearch_to_tsquery('simple', ${query}) and title like 'S-%'
      order by ts_rank(search, websearch_to_tsquery('simple', ${query})) desc, title
    `;
    return rows.map((row) => row.title as string);
  }

  it("finds notes by words of title and body, ranking title matches first", async () => {
    await insertNote(db, userId, {
      title: "S-Deployment guide",
      body: "Docker compose on the server",
    });
    await insertNote(db, userId, { title: "S-Server notes", body: "Nothing about it here" });
    await insertNote(db, userId, { title: "S-Unrelated", body: "Kubernetes über alles" });

    expect(await search("docker")).toEqual(["S-Deployment guide"]);
    expect(await search("server")).toEqual(["S-Server notes", "S-Deployment guide"]);
    expect(await search("über")).toEqual(["S-Unrelated"]);
    expect(await search("compose -docker")).toEqual([]);
    expect(await search("missing")).toEqual([]);
  });

  it("follows changes of title and body", async () => {
    const id = await insertNote(db, userId, { title: "S-Before", body: "alpha" });
    await db.sql`update notes set title = 'S-After', body = 'beta' where id = ${id}`;
    expect(await search("alpha")).toEqual([]);
    expect(await search("before")).toEqual([]);
    expect(await search("beta after")).toEqual(["S-After"]);
  });

  it("weights the title A and the body B", async () => {
    const [row] = await db.sql`
      insert into notes ${db.sql(note({ title: "Weighted", body: "plain" }))} returning search::text
    `;
    expect(row?.search).toBe("'plain':2B 'weighted':1A");
  });

  it("is used through the GIN index", async () => {
    // Few rows: without this the planner rightly prefers reading the table.
    const plan = await db.sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      return tx`explain select id from notes where search @@ to_tsquery('simple', 'docker')`;
    });
    expect(plan.map((line) => Object.values(line)[0]).join("\n")).toContain("notes_search_idx");
  });
});
