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

// /api/notes/v1: notes and folders into the trash, with the rows and
// revisions each step writes. Restoring: trash-restore.test.ts; listing,
// scope and deleting for good: trash-list, trash-scope, trash-delete.

let world: NotesWorld;
let ada: Auth;
let adaId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

const send = (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

const DAY = 24 * 60 * 60 * 1000;

describe("deleting a note", () => {
  it("moves it to the trash as a version of its own and answers in_trash by id", async () => {
    const tree = await trashTree(world, ada, "N1");
    const before = await trashRows(world.db, "notes", [tree.plan, tree.spec]);
    expect(before.map((row) => [row.inTrash, row.version])).toEqual([
      [false, 1],
      [false, 1],
    ]);

    const trashed = await send("DELETE", `/notes/${tree.plan}`, {
      expectedVersion: 1,
      reason: "obsolete",
    });
    expect(trashed).toMatchObject({
      status: 200,
      body: { kind: "note", id: tree.plan, version: 2, path: "N1/Plan" },
    });
    const { deletedAt, purgeAt, batchId } = trashed.body as {
      deletedAt: string;
      purgeAt: string;
      batchId: string;
    };
    expect(new Date(purgeAt).getTime() - new Date(deletedAt).getTime()).toBe(28 * DAY);

    // The row: in the trash, by ada, its own batch; the other note untouched.
    expect(await trashRows(world.db, "notes", [tree.plan, tree.spec])).toEqual([
      {
        id: tree.plan,
        version: 2,
        inTrash: true,
        deletedByName: "ada",
        deletedByUserId: adaId,
        deletedByTokenId: null,
        batchId,
      },
      before[1],
    ]);
    const revisions = await revisionRows(world.db, tree.plan);
    expect(revisions.map((row) => [row.version, row.change, row.reason, row.actor_name])).toEqual([
      [1, "created", null, "ada"],
      [2, "deleted", "obsolete", "ada"],
    ]);

    // Named by id: in_trash with the times; gone from the tree and search.
    const read = await send("GET", `/notes/${tree.plan}`);
    expect(read).toMatchObject({ status: 409, body: { error: "in_trash", deletedAt, purgeAt } });
    const listed = await send("GET", `/tree?folder=${tree.projects}`);
    expect((listed.body.notes as { id: string }[]).map((note) => note.id)).toEqual([]);
    const search = await send("GET", "/search?q=plan");
    expect(JSON.stringify(search.body)).not.toContain(tree.plan);
    // Writing to it, or deleting it again: in_trash too, and nothing written.
    const again = await send("DELETE", `/notes/${tree.plan}`, { expectedVersion: 2 });
    expect(again.body.error).toBe("in_trash");
    expect((await revisionRows(world.db, tree.plan)).length).toBe(2);
    // Its title is free again in the folder.
    const reuse = await send("POST", "/notes", {
      folderId: tree.projects,
      title: "Plan",
      body: "",
    });
    expect(reuse.status).toBe(201);
  });

  it("refuses a stale version and leaves the note as it is", async () => {
    const tree = await trashTree(world, ada, "N2");
    const stale = await send("DELETE", `/notes/${tree.plan}`, { expectedVersion: 5 });
    expect(stale.body).toMatchObject({ error: "version_conflict", currentVersion: 1 });
    expect((await trashRows(world.db, "notes", [tree.plan]))[0]).toMatchObject({
      inTrash: false,
      version: 1,
      batchId: null,
    });
  });
});

describe("deleting a folder", () => {
  it("takes its subtree along as one batch; what was in the trash keeps its own", async () => {
    const tree = await trashTree(world, ada, "F1");
    const earlier = await send("DELETE", `/notes/${tree.draft}`, { expectedVersion: 1 });
    const earlierBatch = earlier.body.batchId as string;

    const trashed = await send("DELETE", `/folders/${tree.web}`, { reason: "cleanup" });
    expect(trashed).toMatchObject({
      status: 200,
      body: { kind: "folder", id: tree.web, path: "F1/Web", folderCount: 1, noteCount: 1 },
    });
    const batchId = trashed.body.batchId as string;
    expect(batchId).not.toBe(earlierBatch);

    const inBatch = { inTrash: true, deletedByName: "ada", deletedByUserId: adaId, batchId };
    expect(await trashRows(world.db, "folders", [tree.web, tree.old, tree.projects])).toEqual([
      { id: tree.web, deletedByTokenId: null, ...inBatch },
      { id: tree.old, deletedByTokenId: null, ...inBatch },
      {
        id: tree.projects,
        inTrash: false,
        deletedByName: null,
        deletedByUserId: null,
        deletedByTokenId: null,
        batchId: null,
      },
    ]);
    const notes = await trashRows(world.db, "notes", [tree.spec, tree.draft, tree.plan]);
    expect(notes[0]).toMatchObject({ version: 2, ...inBatch });
    // Deleted earlier: still its own batch and version.
    expect(notes[1]).toMatchObject({ version: 2, inTrash: true, batchId: earlierBatch });
    expect(notes[2]).toMatchObject({ version: 1, inTrash: false, batchId: null });

    const revisions = await revisionRows(world.db, tree.spec);
    expect(revisions.map((row) => [row.change, row.reason, row.actor_name])).toEqual([
      ["created", null, "ada"],
      ["deleted", "cleanup", "ada"],
    ]);
    expect((await revisionRows(world.db, tree.draft)).map((row) => row.reason)).toEqual([
      null,
      null,
    ]);
    // The folder and what is in it are gone from the tree.
    const top = await send("GET", `/tree?folder=${tree.projects}`);
    expect(top.body.folders).toEqual([]);
    // Named by its id it is in the trash, with the batch it went with.
    const listed = await send("GET", `/tree?folder=${tree.web}`);
    expect(listed).toMatchObject({
      status: 409,
      body: { error: "folder_in_trash", batchId, deletedAt: trashed.body.deletedAt },
    });
    // A folder in the trash takes no new notes.
    const into = await send("POST", "/notes", { folderId: tree.web, title: "New", body: "" });
    expect(into.body.error).toBe("folder_in_trash");
  });
});

describe("changes", () => {
  it("lists notes in the trash with deleted: true", async () => {
    const since = new Date().toISOString();
    const tree = await trashTree(world, ada, "C1");
    await send("DELETE", `/folders/${tree.web}`, { reason: "gone" });
    const changes = await send("GET", `/changes?since=${encodeURIComponent(since)}`);
    const spec = (changes.body.changes as Record<string, unknown>[]).find(
      (entry) => entry.noteId === tree.spec,
    );
    // Its path as it was, although the folder is in the trash as well.
    expect(spec).toMatchObject({
      change: "deleted",
      deleted: true,
      reason: "gone",
      folderPath: "C1/Web",
    });
  });
});
