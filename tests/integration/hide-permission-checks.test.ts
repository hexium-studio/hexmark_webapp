import { beforeAll, describe, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  expectAccepted,
  expectRefused,
  insertFolder,
  insertNote,
  insertToken,
  tokenRow,
} from "./notes-harness";
import { insertUser } from "./two-factor-harness";

// The permission hide (migration 0011) in every permission check: a token's
// base set, its legacy permissions and the entries for folders and notes.
// The checks were widened by exactly this value: look-alikes stay refused.

let db: TestDatabase;
let userId: string;
let allowToken: string;
let folderId: string;
let noteId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  allowToken = await insertToken(db, userId, { access_mode: "allow_list", base_permissions: null });
  folderId = await insertFolder(db, userId);
  noteId = await insertNote(db, userId, { folder_id: folderId });
});

const LOOK_ALIKES = [["hidden"], ["Hide"], ["unhide"], ["hide "], ["read", "hidden"]];
const ALL = ["read", "search", "create", "edit", "move", "delete", "lock", "hide"];

const entry = (kind: "folder" | "note", permissions: unknown) => ({
  token_id: allowToken,
  token_access_mode: "allow_list",
  target_kind: kind,
  folder_id: kind === "folder" ? folderId : null,
  note_id: kind === "note" ? noteId : null,
  permissions,
});

describe("permission checks: hide", () => {
  it("accepts hide in a token's base set and legacy permissions", async () => {
    for (const permissions of [["hide"], ["read", "hide"], ALL]) {
      await expectAccepted(db, "api_tokens", tokenRow(userId, { base_permissions: permissions }));
      await expectAccepted(db, "api_tokens", tokenRow(userId, { permissions }));
    }
  });

  it("still refuses look-alikes in a token's base set and legacy permissions", async () => {
    for (const permissions of LOOK_ALIKES) {
      await expectRefused(
        db,
        "api_tokens",
        tokenRow(userId, { base_permissions: permissions }),
        "api_tokens_base_permissions_check",
      );
      await expectRefused(
        db,
        "api_tokens",
        tokenRow(userId, { permissions }),
        "api_tokens_permissions_check",
      );
    }
  });

  it("accepts hide on folder and note entries", async () => {
    for (const permissions of [["hide"], ["read", "hide"]]) {
      await expectAccepted(db, "api_token_entries", entry("folder", permissions));
      await expectAccepted(db, "api_token_entries", entry("note", permissions));
    }
    await expectAccepted(db, "api_token_entries", entry("folder", ALL));
  });

  it("still refuses look-alikes, and create or search on a note entry", async () => {
    const check = "api_token_entries_permissions_check";
    for (const permissions of LOOK_ALIKES) {
      await expectRefused(db, "api_token_entries", entry("folder", permissions), check);
      await expectRefused(db, "api_token_entries", entry("note", permissions), check);
    }
    for (const permissions of [["hide", "create"], ["hide", "search"], ALL]) {
      await expectRefused(db, "api_token_entries", entry("note", permissions), check);
    }
  });
});
