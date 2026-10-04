import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  expectAccepted,
  expectRefused,
  insertFolder,
  insertNote,
  insertRow,
  insertToken,
  UNKNOWN_ID,
} from "./notes-harness";
import { insertUser, tryInsert } from "./two-factor-harness";

// The api_token_entries table (migration 0010): the targets of a token's
// allow or deny list and the rules the database enforces on its own
// (cascades: api-token-entries-cascades.test.ts).

let db: TestDatabase;
let userId: string;
let allowToken: string;
let denyToken: string;
let folderId: string;
let noteId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = await insertUser(db, "owner");
  allowToken = await insertToken(db, userId, { access_mode: "allow_list", base_permissions: null });
  denyToken = await insertToken(db, userId);
  folderId = await insertFolder(db, userId);
  noteId = await insertNote(db, userId, { folder_id: folderId });
});

const ALL = ["read", "search", "create", "edit", "move", "delete", "lock", "hide"];
const NOTE_ALL = ["read", "edit", "move", "delete", "lock", "hide"];
const PERMISSIONS = "api_token_entries_permissions_check";
const TARGET = "api_token_entries_target_check";

const folderEntry = (values: Record<string, unknown> = {}) => ({
  token_id: allowToken,
  token_access_mode: "allow_list",
  target_kind: "folder",
  folder_id: folderId,
  permissions: ["read"],
  ...values,
});
const noteEntry = (values: Record<string, unknown> = {}) =>
  folderEntry({ target_kind: "note", folder_id: null, note_id: noteId, ...values });
const denied = () => ({ token_id: denyToken, token_access_mode: "deny_list", permissions: null });

const entriesOf = async (tokenId: string) =>
  (await db.sql`select target_kind from api_token_entries where token_id = ${tokenId}`).length;

describe("api_token_entries: permissions", () => {
  it("accepts every permission on a folder and the note set on a note", async () => {
    const [row] = await db.sql`
      insert into api_token_entries ${db.sql(folderEntry({ permissions: ALL }))} returning *
    `;
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.created_at).toBeInstanceOf(Date);
    await db.sql`delete from api_token_entries where id = ${row?.id}`;
    await expectAccepted(db, "api_token_entries", noteEntry({ permissions: NOTE_ALL }));
    for (const permission of NOTE_ALL) {
      await expectAccepted(db, "api_token_entries", noteEntry({ permissions: [permission] }));
    }
  });

  it("refuses create and search on a single note", async () => {
    for (const permissions of [["create"], ["search"], ["read", "search"], ALL]) {
      await expectRefused(db, "api_token_entries", noteEntry({ permissions }), PERMISSIONS);
    }
  });

  it("refuses missing, empty, unknown, null and nested permissions in allow_list", async () => {
    for (const permissions of [null, [], ["admin"], ["Read"], [null], ["read", null]]) {
      await expectRefused(db, "api_token_entries", folderEntry({ permissions }), PERMISSIONS);
      await expectRefused(db, "api_token_entries", noteEntry({ permissions }), PERMISSIONS);
    }
    await expect(
      db.sql`
        insert into api_token_entries (token_id, token_access_mode, target_kind, folder_id,
          permissions)
        values (${allowToken}, 'allow_list', 'folder', ${folderId}, '{{read},{edit}}'::text[])
      `,
    ).rejects.toMatchObject({ constraint_name: PERMISSIONS });
  });

  it("accepts deny_list entries only without permissions", async () => {
    await expectAccepted(db, "api_token_entries", folderEntry(denied()));
    await expectAccepted(db, "api_token_entries", noteEntry(denied()));
    for (const permissions of [["read"], []]) {
      const row = folderEntry({ ...denied(), permissions });
      await expectRefused(db, "api_token_entries", row, PERMISSIONS);
    }
  });
});

describe("api_token_entries: targets and token mode", () => {
  it("refuses an unknown kind and an id that does not match the kind", async () => {
    // An unknown kind fails the kind check and the target check alike;
    // PostgreSQL names whichever it evaluates first.
    for (const kind of ["tag", "Folder", ""]) {
      await expect(
        tryInsert(db, "api_token_entries", folderEntry({ target_kind: kind })),
      ).rejects.toMatchObject({
        constraint_name: expect.stringMatching(/^api_token_entries_target(_kind)?_check$/),
      });
    }
    const [kindCheck] = await db.sql`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where conname = 'api_token_entries_target_kind_check'
    `;
    expect(kindCheck?.definition).toContain("ARRAY['folder'::text, 'note'::text]");
    await expectRefused(db, "api_token_entries", folderEntry({ folder_id: null }), TARGET);
    await expectRefused(db, "api_token_entries", folderEntry({ note_id: noteId }), TARGET);
    await expectRefused(db, "api_token_entries", noteEntry({ note_id: null }), TARGET);
    await expectRefused(db, "api_token_entries", noteEntry({ folder_id: folderId }), TARGET);
    const swapped = folderEntry({ folder_id: null, note_id: noteId });
    await expectRefused(db, "api_token_entries", swapped, TARGET);
  });

  it("refuses unknown targets and tokens, and a mode other than the token's", async () => {
    const fk = (name: string) => `api_token_entries_${name}`;
    await expectRefused(
      db,
      "api_token_entries",
      folderEntry({ folder_id: UNKNOWN_ID }),
      fk("folder_id_folders_id_fk"),
    );
    await expectRefused(
      db,
      "api_token_entries",
      noteEntry({ note_id: UNKNOWN_ID }),
      fk("note_id_notes_id_fk"),
    );
    await expectRefused(
      db,
      "api_token_entries",
      folderEntry({ token_id: UNKNOWN_ID }),
      fk("token_fk"),
    );
    const wrongMode = folderEntry({ token_access_mode: "deny_list", permissions: null });
    await expectRefused(db, "api_token_entries", wrongMode, fk("token_fk"));
  });

  it("refuses a target listed twice for one token, not for two tokens", async () => {
    await insertRow(db, "api_token_entries", folderEntry());
    await insertRow(db, "api_token_entries", noteEntry());
    await expectRefused(
      db,
      "api_token_entries",
      folderEntry({ permissions: ["edit"] }),
      "api_token_entries_token_id_folder_id_unique",
    );
    await expectRefused(
      db,
      "api_token_entries",
      noteEntry(),
      "api_token_entries_token_id_note_id_unique",
    );
    await expectAccepted(db, "api_token_entries", folderEntry(denied()));
  });

  it("changes a token's mode only once its entries are gone", async () => {
    const tokenId = await insertToken(db, userId, {
      access_mode: "allow_list",
      base_permissions: null,
    });
    await insertRow(db, "api_token_entries", folderEntry({ token_id: tokenId }));
    await expect(
      db.sql`
        update api_tokens set access_mode = 'deny_list', base_permissions = '{read}'
        where id = ${tokenId}
      `,
    ).rejects.toMatchObject({ constraint_name: "api_token_entries_token_fk" });
    await db.sql.begin(async (tx) => {
      await tx`delete from api_token_entries where token_id = ${tokenId}`;
      await tx`
        update api_tokens set access_mode = 'deny_list', base_permissions = '{read}'
        where id = ${tokenId}
      `;
      await tx`insert into api_token_entries ${tx(folderEntry({ ...denied(), token_id: tokenId }))}`;
    });
    expect(await entriesOf(tokenId)).toBe(1);
  });
});
