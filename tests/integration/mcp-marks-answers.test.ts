import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// Answers about locks and hidden marks an agent test asked for: a folder
// batch holding a hidden item (hidden, naming it) versus items out of reach
// (forbidden hidden_content, naming nothing) - hidden first when both lie
// inside - for delete_folder and restore_folder; list_changes with the same
// locked and hidden objects as every read; locking what is locked already
// and hiding what is hidden already.

const ALL = ["read", "search", "create", "edit", "move", "delete", "lock", "hide"];

let world: NotesWorld;
let ada: Auth;
let mcp: Client;
const ids: Record<string, string> = {};

const post = (path: string, body: unknown = { reason: "Private" }) =>
  call(world.server, ada, "POST", `${notesApi}${path}`, body);

const note = (folderId: string | undefined, title: string) =>
  createNote(world, ada, { folderId: folderId ?? null, title, body: "x" });

// A folder with a note the token cannot reach, one with a note hidden by a
// person, one with both, and one with neither.
async function boxes(prefix: string) {
  for (const box of ["Out", "Hid", "Both", "Fine"]) {
    const key = `${prefix}${box}`;
    ids[key] = await createFolder(world, ada, key);
    await note(ids[key], "Visible");
    if (box === "Out" || box === "Both") ids[`${key}Excluded`] = await note(ids[key], "Excluded");
    if (box === "Fine" || box === "Out") continue;
    ids[`${key}Hidden`] = await note(ids[key], "Hushed");
    expect((await post(`/notes/${ids[`${key}Hidden`]}/hide`)).status).toBe(200);
  }
}

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  await boxes("Del");
  await boxes("Res");
  ids.vault = await createFolder(world, ada, "Vault");
  ids.inner = await createFolder(world, ada, "Inner", ids.vault);
  ids.deepNote = await note(ids.inner, "Deep");
  ids.free = await note(undefined, "Free");
  ids.pinned = await note(undefined, "Pinned");
  expect((await post(`/folders/${ids.vault}/lock`)).status).toBe(200);
  expect((await post(`/notes/${ids.pinned}/lock`)).status).toBe(200);
  expect((await post(`/notes/${ids.pinned}/hide`)).status).toBe(200);
  const created = await apiToken(world, ada, {
    name: "marks",
    mode: "deny_list",
    basePermissions: ALL,
    entries: ["DelOut", "DelBoth", "ResOut", "ResBoth"].map((box) => ({
      kind: "note",
      id: ids[`${box}Excluded`],
    })),
  });
  mcp = await connectMcp(world.server, created.token);
  // Into the trash after the token lists its entries (entries name items in use).
  for (const box of ["Out", "Hid", "Both", "Fine"]) {
    const path = `${notesApi}/folders/${ids[`Res${box}`]}`;
    expect((await call(world.server, ada, "DELETE", path, {})).status).toBe(200);
  }
});

const state = async (folder: string) =>
  world.db.sql`
    select (select deleted_at is not null from folders where id = ${folder}) as folder_deleted,
      (select count(*)::int from notes where folder_id = ${folder} and deleted_at is null) as live
  `;

describe("a folder batch with items the agent cannot see", () => {
  it("delete_folder: hidden names the hidden note, hidden_content names nothing, hidden first", async () => {
    const before = await Promise.all(
      ["DelOut", "DelHid", "DelBoth"].map((box) => state(ids[box] ?? "")),
    );
    expect(before.map((rows) => rows[0])).toEqual([
      { folder_deleted: false, live: 2 },
      { folder_deleted: false, live: 2 },
      { folder_deleted: false, live: 3 },
    ]);
    const out = await tool(mcp, "delete_folder", { folder_id: ids.DelOut });
    expect(out.data).toMatchObject({ error: "forbidden", reason: "hidden_content" });
    expect(JSON.stringify(out.data)).not.toContain(ids.DelOutExcluded);
    const hid = await tool(mcp, "delete_folder", { folder_id: ids.DelHid });
    expect(hid.data).toMatchObject({
      error: "hidden",
      hiddenItem: { kind: "note", id: ids.DelHidHidden, path: "DelHid/Hushed" },
    });
    const both = await tool(mcp, "delete_folder", { folder_id: ids.DelBoth });
    expect(both.data).toMatchObject({ error: "hidden", hiddenItem: { id: ids.DelBothHidden } });
    const after = await Promise.all(
      ["DelOut", "DelHid", "DelBoth"].map((box) => state(ids[box] ?? "")),
    );
    expect(after).toEqual(before);
    // The batch it can see whole still goes.
    expect((await tool(mcp, "delete_folder", { folder_id: ids.DelFine })).data).toMatchObject({
      noteCount: 1,
    });
    expect((await state(ids.DelFine ?? ""))[0]).toEqual({ folder_deleted: true, live: 0 });
  });

  it("restore_folder: the same rule and order", async () => {
    const out = await tool(mcp, "restore_folder", { folder_id: ids.ResOut });
    expect(out.data).toMatchObject({ error: "forbidden", reason: "hidden_content" });
    const hid = await tool(mcp, "restore_folder", { folder_id: ids.ResHid });
    expect(hid.data).toMatchObject({ error: "hidden", hiddenItem: { id: ids.ResHidHidden } });
    const both = await tool(mcp, "restore_folder", { folder_id: ids.ResBoth });
    expect(both.data).toMatchObject({ error: "hidden", hiddenItem: { id: ids.ResBothHidden } });
    for (const box of ["ResOut", "ResHid", "ResBoth"]) {
      expect((await state(ids[box] ?? ""))[0], box).toEqual({ folder_deleted: true, live: 0 });
    }
    expect((await tool(mcp, "restore_folder", { folder_id: ids.ResFine })).data).toMatchObject({
      restoredNotes: 1,
    });
    expect((await state(ids.ResFine ?? ""))[0]).toEqual({ folder_deleted: false, live: 1 });
  });
});

describe("list_changes", () => {
  it("shows locked and hidden as the objects every read shows, or null", async () => {
    const answer = await tool(mcp, "list_changes", { since: "2000-01-01T00:00:00Z", limit: 100 });
    const changes = answer.data.changes as Record<string, unknown>[];
    const entry = (id: string | undefined) => changes.find((change) => change.noteId === id);
    expect(entry(ids.free)).toMatchObject({ locked: null, hidden: null });
    expect(entry(ids.pinned)).toMatchObject({
      locked: {
        by: "ada",
        reason: "Private",
        inherited: false,
        from: { kind: "note", id: ids.pinned },
      },
      hidden: {
        by: "ada",
        reason: "Private",
        inherited: false,
        from: { kind: "note", id: ids.pinned },
      },
    });
    expect(entry(ids.deepNote)).toMatchObject({
      locked: { inherited: true, from: { kind: "folder", id: ids.vault, path: "Vault" } },
      hidden: null,
    });
    const read = await tool(mcp, "read_note", { note: ids.deepNote });
    expect((read.data.note as { locked: unknown }).locked).toEqual(entry(ids.deepNote)?.locked);
  });
});

describe("marking what is marked already", () => {
  it("lock: inside a locked folder locked with alreadyLocked; its own lock changed: false", async () => {
    for (const [name, args] of [
      ["lock_note", { note: ids.deepNote, reason: "Again" }],
      ["lock_folder", { folder_id: ids.inner, reason: "Again" }],
    ] as const) {
      const answer = await tool(mcp, name, args);
      expect(answer.isError, name).toBe(true);
      expect(answer.data, name).toMatchObject({
        error: "locked",
        alreadyLocked: true,
        lockedItem: { kind: "folder", id: ids.vault, path: "Vault" },
      });
      expect(answer.data.message, name).toContain("locked already");
    }
    const own = await tool(mcp, "lock_folder", { folder_id: ids.vault, reason: "Again" });
    expect(own.data).toMatchObject({ changed: false, locked: { reason: "Private" } });
    expect(own.data.message).toContain("lock of its own already");
    const fresh = await tool(mcp, "lock_note", { note: ids.free, reason: "Keep" });
    expect(fresh.data).toMatchObject({ changed: true, locked: { reason: "Keep" } });
    expect(fresh.data.message).toBeUndefined();
    const folderIds = [ids.vault ?? "", ids.inner ?? ""];
    const rows = await world.db.sql`
      select id, lock_reason from folders where id = any(${folderIds}::uuid[]) order by name`;
    expect(rows).toEqual([
      { id: ids.inner, lock_reason: null },
      { id: ids.vault, lock_reason: "Private" },
    ]);
  });

  it("hide: hidden itself already answers changed: false with a message", async () => {
    const box = ids.DelHid ?? "";
    expect((await post(`/folders/${box}/hide`)).status).toBe(200);
    const again = await tool(mcp, "hide_folder", { folder_id: box, reason: "Again" });
    expect(again.data).toMatchObject({ changed: false, hidden: { by: "ada", reason: "Private" } });
    expect(again.data.message).toContain("hidden itself already");
    const fresh = await tool(mcp, "hide_note", { note: ids.free, reason: "Hush" });
    expect(fresh.data).toMatchObject({ changed: true });
    expect(fresh.data.message).toBeUndefined();
    const [row] = await world.db.sql`select hide_reason from folders where id = ${box}`;
    expect(row).toEqual({ hide_reason: "Private" });
  });
});
