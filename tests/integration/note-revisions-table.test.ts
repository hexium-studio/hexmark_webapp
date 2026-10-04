import { beforeAll, describe, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  byToken,
  byUser,
  expectAccepted,
  expectRefused,
  insertNote,
  insertToken,
  UNKNOWN_ID,
} from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The note_revisions table (migration 0005): the rules the database enforces
// on its own.

let db: TestDatabase;
let userId: string;
let noteId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  noteId = await insertNote(db, userId);
});

const revision = (values: Record<string, unknown> = {}) => ({
  note_id: noteId,
  version: 1,
  title: "Plan",
  body: "# Plan",
  change: "created",
  ...byUser("actor", userId),
  ...values,
});

describe("note_revisions", () => {
  it("accepts every change kind, a folder that no longer exists and a 500-character reason", async () => {
    for (const change of ["created", "edited", "renamed", "moved", "deleted", "restored"]) {
      await expectAccepted(db, "note_revisions", revision({ change }));
    }
    // A snapshot keeps the folder id even if that folder is gone (no foreign key).
    await expectAccepted(db, "note_revisions", revision({ folder_id: UNKNOWN_ID }));
    await expectAccepted(db, "note_revisions", revision({ reason: "r".repeat(500) }));
    const tokenId = await insertToken(db, userId);
    await expectAccepted(
      db,
      "note_revisions",
      revision({ actor_user_id: null, ...byToken("actor", tokenId) }),
    );
  });

  it("refuses an unknown change, a long reason and invalid snapshots", async () => {
    await expectRefused(
      db,
      "note_revisions",
      revision({ change: "purged" }),
      "note_revisions_change_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ change: "Created" }),
      "note_revisions_change_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ reason: "r".repeat(501) }),
      "note_revisions_reason_length_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ version: 0 }),
      "note_revisions_version_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ title: "" }),
      "note_revisions_title_length_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ body: "x".repeat(1_048_577) }),
      "note_revisions_body_size_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ metadata: db.sql.json([]) }),
      "note_revisions_metadata_object_check",
    );
  });

  it("refuses both actor ids, an empty actor name and an unknown note", async () => {
    const tokenId = await insertToken(db, userId);
    await expectRefused(
      db,
      "note_revisions",
      revision({ actor_token_id: tokenId }),
      "note_revisions_actor_single_id_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ actor_name: "" }),
      "note_revisions_actor_name_length_check",
    );
    await expectRefused(
      db,
      "note_revisions",
      revision({ note_id: UNKNOWN_ID }),
      "note_revisions_note_id_notes_id_fk",
    );
  });

  it("allows each version of a note once", async () => {
    await db.sql`insert into note_revisions ${db.sql(revision({ version: 3 }))}`;
    await expectRefused(
      db,
      "note_revisions",
      revision({ version: 3, change: "edited" }),
      "note_revisions_note_id_version_unique",
    );
    const other = await insertNote(db, userId);
    await expectAccepted(db, "note_revisions", revision({ note_id: other, version: 3 }));
  });
});
