import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { PASSWORD } from "./auth-harness";
import {
  type Auth,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// Folders in the audit log: creating, renaming and moving (with the reason
// folders now take again, kept only in the log), the trash and back (the
// folder's event listing the batch, an event per item; more in
// audit-folder-batches.test.ts); and
// name_taken naming the folder that holds the name, like title_taken does
// for notes.

let world: NotesWorld;
let ada: Auth;
let adaId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

afterAll(async () => {
  expect(await expectNoSecrets(world.db, [PASSWORD, "folder-body-6e2f"])).toBeGreaterThan(5);
});

const send = (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

const folderRow = async (id: string) =>
  (await world.db.sql`select name, parent_id from folders where id = ${id}`)[0];

describe("folder changes", () => {
  it("logs creating, renaming and moving once each, with paths and the reason", async () => {
    const created = await oneEvent(world.db, () => send("POST", "/folders", { name: "Alpha" }));
    const id = (created.result as { body: { id: string } }).body.id;
    expect(created.event).toMatchObject({
      actor_user_id: adaId,
      source: "web",
      action: "folder.created",
      target_kind: "folder",
      target_id: id,
      target_label: "Alpha",
      details: { parentId: null },
    });
    const renamed = await oneEvent(world.db, () =>
      send("PATCH", `/folders/${id}`, { name: "Beta", reason: "clearer name" }),
    );
    expect(renamed.event).toMatchObject({
      action: "folder.renamed",
      target_label: "Beta",
      reason: "clearer name",
      details: { changed: true, previousName: "Alpha", name: "Beta", previousPath: "Alpha" },
    });
    const parent = await createFolder(world, ada, "Home");
    const moved = await oneEvent(world.db, () =>
      send("POST", `/folders/${id}/move`, { parentId: parent, reason: "belongs there" }),
    );
    expect(moved.event).toMatchObject({
      action: "folder.moved",
      target_label: "Home/Beta",
      reason: "belongs there",
      details: { previousPath: "Beta", previousParentId: null, parentId: parent },
    });
    const same = await oneEvent(world.db, () =>
      send("PATCH", `/folders/${id}`, { name: "Beta", reason: "no-op" }),
    );
    expect(same.event).toMatchObject({
      action: "folder.renamed",
      reason: null,
      details: { changed: false },
    });
  });

  it("logs a folder into the trash and back with the batch, and each item on its own", async () => {
    const top = await createFolder(world, ada, "Old");
    const child = await createFolder(world, ada, "Inner", top);
    const note = await createNote(world, ada, {
      folderId: child,
      title: "N",
      body: "folder-body-6e2f",
    });
    const deleted = await eventsOf(world.db, () =>
      send("DELETE", `/folders/${top}`, { reason: "tidy" }),
    );
    const batchId = (deleted.result as { body: { batchId: string } }).body.batchId;
    const items = [
      { kind: "folder", id: child, path: "Old/Inner" },
      { kind: "note", id: note, path: "Old/Inner/N" },
    ];
    const viaFolder = { id: top, path: "Old" };
    expect(deleted.events).toEqual([
      expect.objectContaining({
        action: "folder.deleted",
        target_id: top,
        target_label: "Old",
        reason: "tidy",
        details: { batchId, folderCount: 1, noteCount: 1, items },
      }),
      expect.objectContaining({
        action: "folder.deleted",
        target_id: child,
        reason: "tidy",
        details: { batchId, viaFolder },
      }),
      expect.objectContaining({
        action: "note.deleted",
        target_id: note,
        reason: "tidy",
        details: expect.objectContaining({ batchId, viaFolder, change: "deleted" }),
      }),
    ]);
    const restored = await eventsOf(world.db, () =>
      send("POST", `/folders/${top}/restore`, { reason: "needed" }),
    );
    expect(restored.result).toMatchObject({
      status: 200,
      body: { batchId, restoredSubfolders: 1, restoredNotes: 1 },
    });
    expect(restored.events.map((event) => [event.action, event.target_id])).toEqual([
      ["folder.restored", top],
      ["folder.restored", child],
      ["note.restored", note],
    ]);
    expect(restored.events[0]).toMatchObject({
      reason: "needed",
      details: { batchId, restoredSubfolders: 1, restoredNotes: 1, items },
    });
  });
});

describe("name_taken", () => {
  it("names the folder holding the name, on every way a folder gets one", async () => {
    const parent = await createFolder(world, ada, "Taken");
    const holder = await createFolder(world, ada, "Same", parent);
    const other = await createFolder(world, ada, "Other", parent);
    const elsewhere = await createFolder(world, ada, "SAME");
    const taken = { error: "name_taken", existingFolderId: holder, path: "Taken/Same" };
    const before = await folderRow(other);

    const attempts = [
      () => send("POST", "/folders", { name: "same", parentId: parent }),
      () => send("PATCH", `/folders/${other}`, { name: "sAme", reason: "clash" }),
      () => send("POST", `/folders/${elsewhere}/move`, { parentId: parent }),
    ];
    for (const attempt of attempts) {
      const { result, events } = await eventsOf(world.db, attempt);
      expect(result).toEqual({ status: 409, body: taken });
      expect(events).toEqual([
        expect.objectContaining({
          outcome: "failure",
          error_code: "name_taken",
          details: expect.objectContaining({
            refusal: { existingFolderId: holder, path: "Taken/Same" },
          }),
        }),
      ]);
    }
    expect(await folderRow(other)).toEqual(before);
    expect((await folderRow(elsewhere))?.parent_id).toBeNull();

    // Restoring into a parent where the name is taken now.
    await send("DELETE", `/folders/${holder}`, {});
    const again = await createFolder(world, ada, "same", parent);
    const restore = await send("POST", `/folders/${holder}/restore`, {});
    expect(restore).toEqual({
      status: 409,
      body: { ...taken, existingFolderId: again, path: "Taken/same" },
    });
  });
});
