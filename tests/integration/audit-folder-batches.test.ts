import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, type LoggedEvent } from "./audit-log-harness";
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
import { type TrashTree, trashRows, trashTree } from "./trash-harness";

// A folder batch in the audit log: the folder's own event (folder.deleted,
// folder.restored, folder.deleted_permanently) lists every subfolder and
// note of the batch with id and path (capped, with itemsTruncated and
// itemsTotal when cut), and every subfolder and note gets an event of its
// own naming the folder as viaFolder - so the log filtered by a note's id
// shows what happened to it.

let world: NotesWorld;
let ada: Auth;
let tree: TrashTree;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  tree = await trashTree(world, ada, "B1");
});

afterAll(async () => {
  expect(await expectNoSecrets(world.db, [PASSWORD])).toBeGreaterThan(20);
});

const send = (method: "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

const via = () => ({ id: tree.projects, path: "B1" });

// The events of one note, newest first, as the query API filters them.
async function historyOf(noteId: string) {
  const answer = await call(
    world.server,
    ada,
    "GET",
    `/api/audit/v1/events?targetKind=note&targetId=${noteId}`,
  );
  expect(answer.status).toBe(200);
  return (answer.body.events as { action: string; details: Record<string, unknown> }[]).map(
    (event) => [event.action, event.details.viaFolder ?? null],
  );
}

const byAction = (events: LoggedEvent[], action: string) =>
  events.filter((event) => event.action === action);

describe("a folder into the trash and back", () => {
  it("lists the batch on the folder's event and logs each item with viaFolder", async () => {
    // Deleted on its own before: keeps its own batch, not part of this one.
    await send("DELETE", `/notes/${tree.spec}`, { expectedVersion: 1 });
    const before = await trashRows(world.db, "notes", [tree.draft, tree.plan]);
    expect(before.map((row) => [row.version, row.inTrash])).toEqual([
      [1, false],
      [1, false],
    ]);

    const { result, events } = await eventsOf(world.db, () =>
      send("DELETE", `/folders/${tree.projects}`, { reason: "tidy B1" }),
    );
    const batchId = (result as { body: { batchId: string } }).body.batchId;
    expect(events).toHaveLength(5);
    const [root] = events.filter((event) => event.target_id === tree.projects);
    expect(root).toMatchObject({
      action: "folder.deleted",
      target_label: "B1",
      reason: "tidy B1",
      details: {
        batchId,
        folderCount: 2,
        noteCount: 2,
        items: [
          { kind: "note", id: tree.plan, path: "B1/Plan" },
          { kind: "folder", id: tree.web, path: "B1/Web" },
          { kind: "folder", id: tree.old, path: "B1/Web/Old" },
          { kind: "note", id: tree.draft, path: "B1/Web/Old/Draft" },
        ],
      },
    });
    expect(root?.details).not.toHaveProperty("itemsTruncated");
    expect(root?.details).not.toHaveProperty("viaFolder");
    const members = events.filter((event) => event !== root);
    expect(members.map((e) => [e.action, e.target_id, e.target_label]).sort()).toEqual(
      [
        ["folder.deleted", tree.old, "B1/Web/Old"],
        ["folder.deleted", tree.web, "B1/Web"],
        ["note.deleted", tree.draft, "B1/Web/Old/Draft"],
        ["note.deleted", tree.plan, "B1/Plan"],
      ].sort(),
    );
    for (const event of members) {
      expect(event).toMatchObject({ reason: "tidy B1", details: { batchId, viaFolder: via() } });
    }
    for (const event of byAction(members, "note.deleted")) {
      expect(event.details).toMatchObject({ change: "deleted", version: 2, previousVersion: 1 });
    }
    expect(events.some((event) => event.target_id === tree.spec)).toBe(false);

    const after = await trashRows(world.db, "notes", [tree.draft, tree.plan]);
    expect(after.map((row) => [row.version, row.inTrash, row.batchId])).toEqual([
      [2, true, batchId],
      [2, true, batchId],
    ]);
    expect(await historyOf(tree.draft)).toEqual([
      ["note.deleted", via()],
      ["note.created", null],
    ]);
  });

  it("restores with the same listing, counts and an event per item", async () => {
    const { result, events } = await eventsOf(world.db, () =>
      send("POST", `/folders/${tree.projects}/restore`, { reason: "back B1" }),
    );
    expect(result).toMatchObject({
      status: 200,
      body: { path: "B1", restoredSubfolders: 2, restoredNotes: 2 },
    });
    expect((result as { body: object }).body).not.toHaveProperty("restoredFolders");
    expect(events).toHaveLength(5);
    const [root] = events.filter((event) => event.target_id === tree.projects);
    expect(root).toMatchObject({
      action: "folder.restored",
      reason: "back B1",
      details: { restoredSubfolders: 2, restoredNotes: 2 },
    });
    expect(root?.details.items).toHaveLength(4);
    const notes = byAction(events, "note.restored");
    expect(notes.map((event) => event.target_id).sort()).toEqual([tree.draft, tree.plan].sort());
    for (const event of notes) {
      expect(event.details).toMatchObject({ viaFolder: via(), version: 3, previousVersion: 2 });
    }
    expect(byAction(events, "folder.restored")).toHaveLength(3);
    expect(await historyOf(tree.draft)).toEqual([
      ["note.restored", via()],
      ["note.deleted", via()],
      ["note.created", null],
    ]);
    // The note deleted on its own stays in the trash and out of the log of this.
    expect((await trashRows(world.db, "notes", [tree.spec]))[0]?.inTrash).toBe(true);
  });

  it("deleting for good lists what went below the folder, each item naming it", async () => {
    await send("DELETE", `/folders/${tree.projects}`, {});
    const { result, events } = await eventsOf(world.db, () =>
      send("DELETE", `/trash/folders/${tree.projects}`),
    );
    expect(result).toMatchObject({ status: 200, body: { notes: 3, folders: 3 } });
    expect(events).toHaveLength(6);
    const [root] = events.filter((event) => event.target_id === tree.projects);
    expect(root).toMatchObject({
      action: "folder.deleted_permanently",
      details: {
        via: "folder",
        folderCount: 2,
        noteCount: 3,
        items: [
          { kind: "note", id: tree.plan, path: "B1/Plan" },
          { kind: "folder", id: tree.web, path: "B1/Web" },
          { kind: "folder", id: tree.old, path: "B1/Web/Old" },
          { kind: "note", id: tree.draft, path: "B1/Web/Old/Draft" },
          { kind: "note", id: tree.spec, path: "B1/Web/Spec" },
        ],
      },
    });
    for (const event of events.filter((e) => e !== root)) {
      expect(event.details).toMatchObject({ viaFolder: via(), runId: root?.details.runId });
    }
    expect((await historyOf(tree.spec))[0]).toEqual(["note.deleted_permanently", via()]);
  });
});

describe("a large batch", () => {
  it("cuts the listing deterministically below the size limit, logging every item", async () => {
    const many = await createFolder(world, ada, "Many");
    await createFolder(world, ada, "Sub", many);
    for (let n = 0; n < 60; n++) {
      const title = `N${String(n).padStart(2, "0")}`;
      await createNote(world, ada, { folderId: many, title, body: "x" });
    }
    const { events } = await eventsOf(world.db, () => send("DELETE", `/folders/${many}`, {}));
    expect(events).toHaveLength(62);
    const [root] = events.filter((event) => event.target_id === many);
    const items = root?.details.items as { path: string }[];
    expect(root?.details).toMatchObject({
      folderCount: 1,
      noteCount: 60,
      itemsTruncated: true,
      itemsTotal: 61,
    });
    expect(items).toHaveLength(50);
    expect(items[0]?.path).toBe("Many/N00");
    expect(items[49]?.path).toBe("Many/N49");
    const [size] = await world.db.sql`
      select pg_column_size(details) as bytes from audit_events where id = ${root?.id ?? ""}`;
    expect(Number(size?.bytes)).toBeLessThan(16 * 1024);
    expect(byAction(events, "note.deleted")).toHaveLength(60);
  });
});
