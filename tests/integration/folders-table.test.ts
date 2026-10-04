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
  trashedBy,
  UNKNOWN_ID,
} from "./notes-harness";
import { insertUser, tryInsert, violation } from "./two-factor-harness";

// The folders table (migration 0005) and the actor columns it shares with
// notes and note_revisions: the rules the database enforces on its own.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
});

const folder = (values: Record<string, unknown> = {}) => ({
  name: "Projects",
  ...byUser("created_by", userId),
  ...byUser("updated_by", userId),
  ...values,
});

describe("folders: name", () => {
  it("accepts 1 and 120 characters, inner spaces and non-Latin text", async () => {
    for (const name of ["a", "x".repeat(120), "Web app vs. API", "Notizen über Ärger", "日本語"]) {
      await expectAccepted(db, "folders", folder({ name }));
    }
  });

  it("refuses empty, too long, a slash and surrounding white space", async () => {
    for (const name of ["", "x".repeat(121), "a/b", "/", " lead", "trail ", "\ttab", "nl\n"]) {
      await expectRefused(db, "folders", folder({ name }), "folders_name_check");
    }
  });

  it("refuses a folder as its own parent and an unknown parent", async () => {
    const id = await insertFolder(db, userId);
    await expect(db.sql`update folders set parent_id = id where id = ${id}`).rejects.toMatchObject({
      constraint_name: "folders_not_own_parent_check",
    });
    await expectRefused(
      db,
      "folders",
      folder({ parent_id: UNKNOWN_ID }),
      "folders_parent_id_folders_id_fk",
    );
  });
});

describe("folders: unique names among siblings", () => {
  it("refuses the same name in another case at root level and inside a folder", async () => {
    const parent = await insertFolder(db, userId, { name: "Root-Dup" });
    await expectRefused(db, "folders", folder({ name: "root-dup" }), "folders_root_name_unique");
    await insertFolder(db, userId, { parent_id: parent, name: "Child" });
    await expectRefused(
      db,
      "folders",
      folder({ parent_id: parent, name: "CHILD" }),
      "folders_parent_id_name_unique",
    );
  });

  it("allows the same name under different parents and next to a trashed folder", async () => {
    const a = await insertFolder(db, userId);
    const b = await insertFolder(db, userId);
    await insertFolder(db, userId, { parent_id: a, name: "Same" });
    await expectAccepted(db, "folders", folder({ parent_id: b, name: "Same" }));
    // A root folder and a subfolder do not collide either.
    await expectAccepted(db, "folders", folder({ name: "Same" }));

    await insertFolder(db, userId, { name: "Trashed", ...trashedBy(userId) });
    await insertFolder(db, userId, { parent_id: a, name: "Trashed", ...trashedBy(userId) });
    await expectAccepted(db, "folders", folder({ name: "trashed" }));
    await expectAccepted(db, "folders", folder({ parent_id: a, name: "TRASHED" }));
  });

  it("refuses restoring a trashed folder whose name was taken meanwhile", async () => {
    const old = await insertFolder(db, userId, { name: "Restore-Me", ...trashedBy(userId) });
    await insertFolder(db, userId, { name: "restore-me" });
    await expect(
      db.sql`update folders set deleted_at = null, deleted_by_user_id = null, deleted_by_name = null, trash_batch_id = null where id = ${old}`,
    ).rejects.toMatchObject({ constraint_name: "folders_root_name_unique" });
  });
});

describe("folders: deleting", () => {
  it("refuses deleting a folder that has subfolders or notes, also trashed ones", async () => {
    const parent = await insertFolder(db, userId);
    const child = await insertFolder(db, userId, { parent_id: parent, ...trashedBy(userId) });
    await expect(db.sql`delete from folders where id = ${parent}`).rejects.toMatchObject({
      code: "23001",
      constraint_name: "folders_parent_id_folders_id_fk",
    });
    await insertNote(db, userId, { folder_id: child, ...trashedBy(userId) });
    await expect(db.sql`delete from folders where id = ${child}`).rejects.toMatchObject({
      code: "23001",
      constraint_name: "notes_folder_id_folders_id_fk",
    });
  });

  it("deletes an empty folder", async () => {
    const id = await insertFolder(db, userId);
    await db.sql`delete from folders where id = ${id}`;
    expect(await db.sql`select id from folders where id = ${id}`).toHaveLength(0);
  });
});

describe("actor columns", () => {
  it("accepts a human, an agent and a row whose ids were both cleared", async () => {
    const tokenId = await insertToken(db, userId);
    await expectAccepted(db, "folders", folder());
    await expectAccepted(
      db,
      "folders",
      folder({ ...byToken("created_by", tokenId), created_by_user_id: null }),
    );
    await expectAccepted(
      db,
      "folders",
      folder({ created_by_user_id: null, updated_by_user_id: null }),
    );
  });

  it("refuses both ids at once, an empty or too long name and a missing name", async () => {
    const tokenId = await insertToken(db, userId);
    await expectRefused(
      db,
      "folders",
      folder({ created_by_token_id: tokenId }),
      "folders_created_by_single_id_check",
    );
    await expectRefused(
      db,
      "folders",
      folder({ updated_by_token_id: tokenId }),
      "folders_updated_by_single_id_check",
    );
    await expectRefused(
      db,
      "folders",
      folder({ created_by_name: "" }),
      "folders_created_by_name_length_check",
    );
    await expectRefused(
      db,
      "folders",
      folder({ updated_by_name: "x".repeat(65) }),
      "folders_updated_by_name_length_check",
    );
    await expectAccepted(db, "folders", folder({ updated_by_name: "x".repeat(64) }));
    await expect(tryInsert(db, "folders", folder({ created_by_name: null }))).rejects.toMatchObject(
      violation.notNull,
    );
  });

  it("refuses an unknown user or token", async () => {
    await expectRefused(
      db,
      "folders",
      folder({ created_by_user_id: UNKNOWN_ID }),
      "folders_created_by_user_id_users_id_fk",
    );
    await expectRefused(
      db,
      "folders",
      folder({ ...byToken("updated_by", UNKNOWN_ID), updated_by_user_id: null }),
      "folders_updated_by_token_id_api_tokens_id_fk",
    );
  });
});
