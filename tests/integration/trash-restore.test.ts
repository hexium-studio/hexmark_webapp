import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";
import { trashRows, trashTree } from "./trash-harness";

// /api/notes/v1: notes and folders back from the trash, with the rows and
// revisions each step writes, and what restoring refuses.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const send = (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

describe("restoring", () => {
  it("brings a folder back with its batch and leaves earlier deletions in the trash", async () => {
    const tree = await trashTree(world, ada, "R1");
    await send("DELETE", `/notes/${tree.draft}`, { expectedVersion: 1 });
    const deleted = await send("DELETE", `/folders/${tree.web}`, { reason: "cleanup" });

    const restored = await send("POST", `/folders/${tree.web}/restore`, { reason: "back" });
    // The counts are what came back with it: one subfolder and one note (the
    // note deleted on its own earlier stays in the trash).
    expect(restored).toMatchObject({
      status: 200,
      body: {
        id: tree.web,
        path: "R1/Web",
        batchId: deleted.body.batchId,
        restoredSubfolders: 1,
        restoredNotes: 1,
      },
    });
    const live = { inTrash: false, deletedByName: null, deletedByUserId: null, batchId: null };
    expect(await trashRows(world.db, "folders", [tree.web, tree.old])).toEqual([
      { id: tree.web, deletedByTokenId: null, ...live },
      { id: tree.old, deletedByTokenId: null, ...live },
    ]);
    const notes = await trashRows(world.db, "notes", [tree.spec, tree.draft]);
    expect(notes[0]).toMatchObject({ version: 3, ...live });
    expect(notes[1]).toMatchObject({ version: 2, inTrash: true });
    const revisions = await revisionRows(world.db, tree.spec);
    expect(revisions.map((row) => [row.change, row.reason])).toEqual([
      ["created", null],
      ["deleted", "cleanup"],
      ["restored", "back"],
    ]);
    expect((await send("GET", `/notes/${tree.spec}`)).body.note).toMatchObject({
      path: "R1/Web/Spec",
      version: 3,
    });
  });

  it("refuses a folder that is in use, one inside a batch and a name taken meanwhile", async () => {
    const tree = await trashTree(world, ada, "R2");
    const live = await send("POST", `/folders/${tree.web}/restore`);
    expect(live).toMatchObject({ status: 409, body: { error: "folder_not_deleted" } });

    await send("DELETE", `/folders/${tree.web}`);
    const inside = await send("POST", `/folders/${tree.old}/restore`, {});
    expect(inside).toMatchObject({
      status: 409,
      body: { error: "parent_in_trash", folderId: tree.web, path: "R2/Web" },
    });

    const holder = await send("POST", "/folders", { name: "web", parentId: tree.projects });
    const taken = await send("POST", `/folders/${tree.web}/restore`, {});
    expect(taken).toMatchObject({
      status: 409,
      body: { error: "name_taken", existingFolderId: holder.body.id, path: "R2/web" },
    });
    // Nothing came back.
    const rows = await trashRows(world.db, "folders", [tree.web, tree.old]);
    expect(rows.map((row) => row.inTrash)).toEqual([true, true]);
    expect((await trashRows(world.db, "notes", [tree.spec]))[0]).toMatchObject({
      inTrash: true,
      version: 2,
    });
  });

  it("restores a note whose folder is in the trash only into another folder", async () => {
    const tree = await trashTree(world, ada, "R3");
    await send("DELETE", `/folders/${tree.web}`);
    const blocked = await send("POST", `/notes/${tree.spec}/restore`, {});
    expect(blocked).toMatchObject({
      status: 409,
      body: { error: "parent_in_trash", folderId: tree.web, path: "R3/Web" },
    });
    // Named explicitly, a folder in the trash is refused the same way.
    const intoTrash = await send("POST", `/notes/${tree.spec}/restore`, { folderId: tree.old });
    expect(intoTrash.body).toMatchObject({ error: "parent_in_trash", folderId: tree.old });
    const unknown = await send("POST", `/notes/${tree.spec}/restore`, {
      folderId: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.body.error).toBe("folder_not_found");

    const elsewhere = await send("POST", `/notes/${tree.spec}/restore`, {
      folderId: tree.projects,
      reason: "keep it",
    });
    expect(elsewhere.body).toMatchObject({ version: 3, path: "R3/Spec", changed: true });
    const [row] = await world.db.sql`
      select folder_id, deleted_at, trash_batch_id from notes where id = ${tree.spec}`;
    expect(row).toEqual({ folder_id: tree.projects, deleted_at: null, trash_batch_id: null });
    const [revision] = await world.db.sql`
      select change, reason, folder_id from note_revisions
      where note_id = ${tree.spec} and version = 3`;
    expect(revision).toEqual({ change: "restored", reason: "keep it", folder_id: tree.projects });
    // The rest of the batch stays in the trash.
    expect((await trashRows(world.db, "notes", [tree.draft]))[0]?.inTrash).toBe(true);
  });

  it("restores into the root level, and refuses a title taken there or a live note", async () => {
    const tree = await trashTree(world, ada, "R4");
    await send("DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    const holder = await send("POST", "/notes", { title: "Plan", body: "" });
    const taken = await send("POST", `/notes/${tree.plan}/restore`, { folderId: null });
    expect(taken).toMatchObject({
      status: 409,
      body: { error: "title_taken", existingNoteId: holder.body.id, path: "Plan" },
    });
    await send("DELETE", `/notes/${holder.body.id as string}`, { expectedVersion: 1 });
    const root = await send("POST", `/notes/${tree.plan}/restore`, { folderId: null });
    expect(root.body).toMatchObject({ path: "Plan", folderPath: "" });
    const live = await send("POST", `/notes/${tree.plan}/restore`);
    expect(live).toMatchObject({ status: 409, body: { error: "note_not_deleted" } });
    expect((await revisionRows(world.db, tree.plan)).map((row) => row.change)).toEqual([
      "created",
      "deleted",
      "restored",
    ]);
  });

  it("restores a note under another title when its own is taken there", async () => {
    const tree = await trashTree(world, ada, "R5");
    await send("DELETE", `/notes/${tree.plan}`, { expectedVersion: 1, reason: "old" });
    const holder = await send("POST", "/notes", {
      folderId: tree.projects,
      title: "plan",
      body: "new plan",
    });
    const taken = await send("POST", `/notes/${tree.plan}/restore`);
    expect(taken.body).toMatchObject({ error: "title_taken", existingNoteId: holder.body.id });
    const [before] = await world.db.sql`
      select title, version, deleted_at is not null as in_trash from notes where id = ${tree.plan}`;
    expect(before).toEqual({ title: "Plan", version: 2, in_trash: true });

    const blank = await send("POST", `/notes/${tree.plan}/restore`, { title: " " });
    expect(blank).toMatchObject({ status: 400, body: { fields: { title: { code: "empty" } } } });
    const renamed = await send("POST", `/notes/${tree.plan}/restore`, {
      title: "Plan (old)",
      reason: "keep both",
    });
    expect(renamed).toMatchObject({
      status: 200,
      body: { path: "R5/Plan (old)", version: 3, changed: true },
    });
    const [after] = await world.db.sql`
      select title, version, deleted_at is not null as in_trash from notes where id = ${tree.plan}`;
    expect(after).toEqual({ title: "Plan (old)", version: 3, in_trash: false });
    const [revision] = await world.db.sql`
      select change, reason, title from note_revisions where note_id = ${tree.plan} and version = 3`;
    expect(revision).toEqual({ change: "restored", reason: "keep both", title: "Plan (old)" });
    // The sections carry the new title: the note is found by it.
    const found = await send("GET", `/search?q=old&folder=${tree.projects}`);
    expect((found.body.hits as { noteId: string }[]).map((hit) => hit.noteId)).toEqual([tree.plan]);
  });
});
