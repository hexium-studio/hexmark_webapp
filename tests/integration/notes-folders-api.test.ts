import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// /api/notes/v1 folders, the tree, moving notes, the trash and restoring.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

describe("folders", () => {
  it("creates, renames and refuses names that are taken or contain a slash", async () => {
    const projects = await createFolder(world, ada, "Projects");
    const web = await send("POST", "/folders", { name: "Web", parentId: projects });
    expect(web).toMatchObject({ status: 201, body: { name: "Web", path: "Projects/Web" } });
    expect((await send("POST", "/folders", { name: "projects" })).body.error).toBe("name_taken");
    expect((await send("POST", "/folders", { name: "a/b" })).status).toBe(400);
    const renamed = await send("PATCH", `/folders/${web.body.id}`, { name: "Website" });
    expect(renamed.body).toMatchObject({ path: "Projects/Website" });
    const [row] = await world.db.sql`select name from folders where id = ${web.body.id as string}`;
    expect(row?.name).toBe("Website");
  });

  it("moves folders but never into themselves", async () => {
    const a = await createFolder(world, ada, "A");
    const b = await createFolder(world, ada, "B", a);
    const c = await createFolder(world, ada, "C", b);
    const cycle = await send("POST", `/folders/${a}/move`, { parentId: c });
    expect(cycle).toMatchObject({ status: 409, body: { error: "folder_cycle" } });
    const self = await send("POST", `/folders/${a}/move`, { parentId: a });
    expect(self.body.error).toBe("folder_cycle");
    const moved = await send("POST", `/folders/${c}/move`, { parentId: null });
    expect(moved.body).toMatchObject({ path: "C", parentId: null });
    const [row] = await world.db.sql`select parent_id from folders where id = ${a}`;
    expect(row?.parent_id).toBeNull();
  });

  it("deletes a folder with what it holds into the trash, never for good", async () => {
    const box = await createFolder(world, ada, "Box");
    await createNote(world, ada, { folderId: box, title: "Inside", body: "" });
    // No body at all: the reason is optional.
    const trashed = await send("DELETE", `/folders/${box}`);
    expect(trashed).toMatchObject({ status: 200, body: { kind: "folder", noteCount: 1 } });
    const rows = await world.db.sql`
      select deleted_at is not null as trashed from folders where id = ${box}`;
    expect(rows).toEqual([{ trashed: true }]);
    expect((await send("GET", `/tree?folder=${box}`)).body.error).toBe("folder_in_trash");
  });
});

describe("tree", () => {
  it("lists folders and note titles to the requested depth", async () => {
    const top = await createFolder(world, ada, "Tree");
    const sub = await createFolder(world, ada, "Sub", top);
    await createNote(world, ada, { folderId: top, title: "Top note", body: "x" });
    await createNote(world, ada, { folderId: sub, title: "Deep note", body: "y" });
    await createFolder(world, ada, "Deeper", sub);
    const one = await send("GET", `/tree?folder=${top}`);
    expect(one.body).toMatchObject({
      folder: { id: top, path: "Tree" },
      notes: [{ title: "Top note", version: 1 }],
    });
    // Where the depth ends: not loaded, so no lists, only what it holds.
    expect(one.body.folders).toEqual([
      {
        id: sub,
        name: "Sub",
        path: "Tree/Sub",
        folderCount: 1,
        noteCount: 1,
        locked: null,
        hidden: null,
        loaded: false,
      },
    ]);
    const two = await send("GET", `/tree?folder=${top}&depth=2`);
    const [subEntry] = two.body.folders as Record<string, unknown>[];
    expect(subEntry).toMatchObject({ loaded: true, folderCount: 1, noteCount: 1 });
    const subNotes = (subEntry?.notes ?? []) as { title: string }[];
    expect(subNotes.map((note) => note.title)).toEqual(["Deep note"]);
    expect(subEntry?.folders).toMatchObject([
      { name: "Deeper", folderCount: 0, noteCount: 0, loaded: false },
    ]);
    expect(JSON.stringify(two.body)).not.toContain('"body"');
    expect((await send("GET", "/tree?depth=0")).status).toBe(400);
  });
});

describe("moving, trash and restore", () => {
  it("moves a note, refuses a taken title in the target and keeps the id", async () => {
    const from = await createFolder(world, ada, "From");
    const to = await createFolder(world, ada, "To");
    const id = await createNote(world, ada, { folderId: from, title: "Wanderer", body: "" });
    await createNote(world, ada, { folderId: to, title: "Clash", body: "" });
    const clash = await createNote(world, ada, { folderId: from, title: "clash", body: "" });
    const moved = await send("POST", `/notes/${id}/move`, { expectedVersion: 1, folderId: to });
    expect(moved.body).toMatchObject({ id, version: 2 });
    const taken = await send("POST", `/notes/${clash}/move`, { expectedVersion: 1, folderId: to });
    expect(taken).toMatchObject({ status: 409, body: { error: "title_taken" } });
    const unknown = await send("POST", `/notes/${clash}/move`, {
      expectedVersion: 1,
      folderId: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.body.error).toBe("folder_not_found");
    const full = await send("GET", `/notes/${id}`);
    expect(full.body.note).toMatchObject({ folderId: to, path: "To/Wanderer" });
    expect((await revisionRows(world.db, id)).map((row) => row.change)).toEqual([
      "created",
      "moved",
    ]);
  });

  it("hides a note in the trash and restores it", async () => {
    const id = await createNote(world, ada, { title: "Trash me", body: "gone" });
    const stale = await send("DELETE", `/notes/${id}`, { expectedVersion: 7 });
    expect(stale.body.error).toBe("version_conflict");
    const trashed = await send("DELETE", `/notes/${id}`, { expectedVersion: 1, reason: "old" });
    expect(trashed.body).toMatchObject({ version: 2 });
    const gone = await send("GET", `/notes/${id}`);
    expect(gone).toMatchObject({ status: 409, body: { error: "in_trash" } });
    const replacement = await createNote(world, ada, { title: "Trash me", body: "new" });
    const blocked = await send("POST", `/notes/${id}/restore`, {});
    expect(blocked.body).toMatchObject({
      error: "title_taken",
      existingNoteId: replacement,
      path: "Trash me",
    });
    await send("PATCH", `/notes/${replacement}`, { expectedVersion: 1, title: "Other" });
    const restored = await send("POST", `/notes/${id}/restore`, { reason: "needed" });
    expect(restored.body).toMatchObject({ version: 3, changed: true, path: "Trash me" });
    expect((await send("POST", `/notes/${id}/restore`, {})).body.error).toBe("note_not_deleted");
    const rows = await revisionRows(world.db, id);
    expect(rows.map((row) => [row.change, row.reason])).toEqual([
      ["created", null],
      ["deleted", "old"],
      ["restored", "needed"],
    ]);
  });
});
