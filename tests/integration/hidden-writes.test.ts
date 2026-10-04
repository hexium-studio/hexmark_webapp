import { beforeAll, describe, expect, it } from "vitest";
import { type HiddenWorld, hiddenWorld, SECRET } from "./hidden-harness";
import { tool } from "./mcp-harness";
import { type Auth, call, notesApi, reauthenticated } from "./notes-api-harness";

// What an agent cannot do with hidden items: every write on a hidden note or
// folder, into a hidden folder, or taking a hidden item along, is refused
// with hidden - before the version is checked - and nothing is written.
// Hidden and locked are checked on their own: both together answer hidden
// with the lock in `locked`; unhiding leaves a real lock. People change
// hidden items as usual.

let h: HiddenWorld;
const api = (
  auth: Auth,
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
) => call(h.world.server, auth, method, `${notesApi}${path}`, body);
const noteState = async (id: string) =>
  (
    await h.world.db.sql`
      select title, version, folder_id, deleted_at, body, locked_at, hidden_at
      from notes where id = ${id}`
  )[0];
const folderState = async (id: string) =>
  (
    await h.world.db
      .sql`select name, parent_id, deleted_at, locked_at, hidden_at from folders where id = ${id}`
  )[0];

beforeAll(async () => {
  h = await hiddenWorld();
});

describe("writes on a hidden note", () => {
  it("are refused with hidden before the version check, and change nothing", async () => {
    const before = await noteState(h.ids.diary);
    const calls = [
      ["update_note", { note: h.ids.diary, expected_version: 2, title: "Renamed" }],
      // A wrong version still answers hidden: no conflict details, no section text.
      [
        "replace_section",
        { note: h.ids.diary, expected_version: 1, section: "Diary", body: "# X\n" },
      ],
      ["move_note", { note: h.ids.diary, expected_version: 2, folder_id: null }],
      ["delete_note", { note: h.ids.diary, expected_version: 2 }],
      ["lock_note", { note: h.ids.diary, reason: "Keep" }],
    ] as const;
    for (const [name, args] of calls) {
      const answer = await tool(h.mcp, name, args);
      expect(answer.data, name).toMatchObject({
        error: "hidden",
        hiddenItem: { kind: "note", id: h.ids.diary, path: "Open/Diary" },
      });
      expect(JSON.stringify(answer.data), name).not.toContain(SECRET);
    }
    expect(await noteState(h.ids.diary)).toEqual(before);
    expect(before?.version).toBe(2);
  });

  it("are allowed to people", async () => {
    const edited = await api(h.ada, "PATCH", `/notes/${h.ids.diary}`, {
      expectedVersion: 2,
      title: "Diary",
      body: `# Diary\n\nThe ${SECRET} is safe.\n`,
    });
    expect(edited.status).toBe(200);
    expect(await noteState(h.ids.diary)).toMatchObject({ version: 3, hidden_at: expect.any(Date) });
  });
});

describe("writes on or into a hidden folder", () => {
  it("are refused with hidden; below it the folders do not exist", async () => {
    const before = await folderState(h.ids.vault);
    const onFolder = [
      ["rename_folder", { folder_id: h.ids.vault, name: "Safe" }],
      ["move_folder", { folder_id: h.ids.vault, parent_id: h.ids.open }],
      ["delete_folder", { folder_id: h.ids.vault }],
      ["lock_folder", { folder_id: h.ids.vault, reason: "Keep" }],
      ["create_note", { folder_id: h.ids.vault, title: "New", body: "x" }],
      ["create_folder", { parent_id: h.ids.vault, name: "New" }],
      ["move_note", { note: h.ids.plain, expected_version: 1, folder_id: h.ids.vault }],
      ["move_folder", { folder_id: h.ids.open, parent_id: h.ids.vault }],
    ] as const;
    for (const [name, args] of onFolder) {
      const answer = await tool(h.mcp, name, args);
      expect(answer.data, name).toMatchObject({
        error: "hidden",
        hiddenItem: { kind: "folder", id: h.ids.vault, path: "Vault" },
        locked: null,
      });
    }
    const below = [
      ["create_note", { folder_id: h.ids.inner, title: "New", body: "x" }],
      ["create_folder", { parent_id: h.ids.inner, name: "New" }],
      ["rename_folder", { folder_id: h.ids.inner, name: "New" }],
      ["move_folder", { folder_id: h.ids.open, parent_id: h.ids.inner }],
      ["hide_folder", { folder_id: h.ids.inner, reason: "Twice" }],
    ] as const;
    for (const [name, args] of below) {
      expect((await tool(h.mcp, name, args)).data, name).toMatchObject({
        error: "folder_not_found",
      });
    }
    expect(await folderState(h.ids.vault)).toEqual(before);
    const count = await h.world.db.sql`select count(*)::int as n from notes where title = 'New'`;
    expect(count[0]?.n).toBe(0);
  });

  it("refuses deleting a folder that holds a hidden note", async () => {
    const answer = await tool(h.mcp, "delete_folder", { folder_id: h.ids.open });
    expect(answer.data).toMatchObject({
      error: "hidden",
      hiddenItem: { kind: "note", id: h.ids.diary, path: "Open/Diary" },
      locked: null,
    });
    expect(await folderState(h.ids.open)).toMatchObject({ deleted_at: null });
  });

  it("refuses restoring a hidden folder a person deleted", async () => {
    const plainFolder = await api(h.ada, "POST", "/folders", { name: "Shelf" });
    const shelf = plainFolder.body.id as string;
    await api(h.ada, "POST", `/folders/${shelf}/hide`, {});
    expect((await api(h.ada, "DELETE", `/folders/${shelf}`, {})).status).toBe(200);
    const answer = await tool(h.mcp, "restore_folder", { folder_id: shelf });
    expect(answer.data).toMatchObject({ error: "hidden", hiddenItem: { id: shelf } });
    expect(await folderState(shelf)).toMatchObject({ deleted_at: expect.any(Date) });
  });
});

describe("hidden and locked", () => {
  it("answers hidden with the lock; unhiding keeps the lock, unlocking frees it", async () => {
    const note = await api(h.ada, "POST", "/notes", {
      folderId: h.ids.open,
      title: "Both",
      body: "x",
    });
    const id = note.body.id as string;
    await api(h.ada, "POST", `/notes/${id}/hide`, { reason: "Hidden" });
    await api(h.ada, "POST", `/notes/${id}/lock`, { reason: "Locked" });
    const edit = () => tool(h.mcp, "update_note", { note: id, expected_version: 1, title: "B2" });
    expect((await edit()).data).toMatchObject({
      error: "hidden",
      hiddenItem: { kind: "note", id },
      reason: "Hidden",
      locked: { lockedItem: { kind: "note", id }, lockedBy: "ada", reason: "Locked" },
    });
    await reauthenticated(h.world.server, h.ada);
    const unhidden = await api(h.ada, "POST", `/notes/${id}/unhide`, {});
    expect(unhidden.body).toMatchObject({ changed: true, hidden: null });
    const row = await noteState(id);
    expect(row).toMatchObject({ hidden_at: null, locked_at: expect.any(Date) });
    expect((await edit()).data).toMatchObject({ error: "locked", lockedItem: { id } });
    await api(h.ada, "POST", `/notes/${id}/unlock`, {});
    expect((await edit()).data).toMatchObject({ version: 2, changed: true });
  });

  it("names the lock of a folder above as well", async () => {
    const folder = await api(h.ada, "POST", "/folders", { name: "Locked box" });
    const box = folder.body.id as string;
    const note = await api(h.ada, "POST", "/notes", { folderId: box, title: "In box", body: "x" });
    await api(h.ada, "POST", `/folders/${box}/lock`, { reason: "Frozen" });
    await api(h.ada, "POST", `/notes/${note.body.id}/hide`, { reason: "Hidden" });
    const answer = await tool(h.mcp, "delete_note", { note: note.body.id, expected_version: 1 });
    expect(answer.data).toMatchObject({
      error: "hidden",
      locked: { lockedItem: { kind: "folder", id: box, path: "Locked box" }, reason: "Frozen" },
    });
  });
});
