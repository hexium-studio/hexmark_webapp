import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";
import { tableCounts, trashTree } from "./trash-harness";

// /api/notes/v1: a folder in the trash named by its id where a folder in use
// is expected answers 409 folder_in_trash (deletedAt, purgeAt, batchId) on
// every endpoint, and nothing is written; a folder that never existed stays
// folder_not_found; folders in use are still renamed and moved.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

async function folderRows() {
  return world.db.sql`
    select id, parent_id, name, deleted_at, trash_batch_id from folders order by id`;
}

describe("a folder in the trash", () => {
  it("is answered folder_in_trash wherever it is named, and nothing changes", async () => {
    const tree = await trashTree(world, ada, "B1");
    const trashed = await send("DELETE", `/folders/${tree.web}`, { reason: "gone" });
    const inTrash = {
      error: "folder_in_trash",
      deletedAt: trashed.body.deletedAt,
      purgeAt: trashed.body.purgeAt,
      batchId: trashed.body.batchId,
    };
    const counts = await tableCounts(world.db);
    const folders = await folderRows();
    const notes = await world.db.sql`select id, folder_id, version from notes order by id`;

    const calls: [string, () => ReturnType<typeof send>][] = [
      ["tree", () => send("GET", `/tree?folder=${tree.web}`)],
      ["search", () => send("GET", `/search?q=spec&folder=${tree.web}`)],
      ["create note", () => send("POST", "/notes", { folderId: tree.web, title: "N", body: "" })],
      [
        "move note into Old (deleted with Web)",
        () => send("POST", `/notes/${tree.plan}/move`, { expectedVersion: 1, folderId: tree.old }),
      ],
      ["create folder", () => send("POST", "/folders", { parentId: tree.web, name: "Sub" })],
      ["rename folder", () => send("PATCH", `/folders/${tree.web}`, { name: "Webs" })],
      ["move folder", () => send("POST", `/folders/${tree.web}/move`, { parentId: null })],
      [
        "move a folder into it",
        () => send("POST", `/folders/${tree.projects}/move`, { parentId: tree.old }),
      ],
      ["delete folder", () => send("DELETE", `/folders/${tree.web}`)],
    ];
    for (const [name, run] of calls) {
      expect(await run(), name).toMatchObject({ status: 409, body: inTrash });
    }
    expect(await tableCounts(world.db)).toEqual(counts);
    expect(await folderRows()).toEqual(folders);
    expect(await world.db.sql`select id, folder_id, version from notes order by id`).toEqual(notes);
  });

  it("does not stand in for a folder that never existed", async () => {
    for (const path of [`/tree?folder=${UNKNOWN}`, `/search?q=x&folder=${UNKNOWN}`]) {
      expect(await send("GET", path), path).toMatchObject({
        status: 404,
        body: { error: "folder_not_found" },
      });
    }
    const renamed = await send("PATCH", `/folders/${UNKNOWN}`, { name: "X" });
    expect(renamed).toMatchObject({ status: 404, body: { error: "folder_not_found" } });
  });
});

describe("folders in use", () => {
  it("are still renamed (edit) and moved (move), with the rows to show it", async () => {
    const tree = await trashTree(world, ada, "B2");
    const renamed = await send("PATCH", `/folders/${tree.web}`, { name: "Site" });
    expect(renamed).toMatchObject({ status: 200, body: { path: "B2/Site" } });
    const moved = await send("POST", `/folders/${tree.old}/move`, { parentId: null });
    expect(moved).toMatchObject({ status: 200, body: { path: "Old", parentId: null } });
    const rows = await world.db.sql`
      select id, parent_id, name from folders where id in (${tree.web}, ${tree.old}) order by name`;
    expect(rows).toEqual([
      { id: tree.old, parent_id: null, name: "Old" },
      { id: tree.web, parent_id: tree.projects, name: "Site" },
    ]);
  });

  it("need edit to rename and move to move, as the HTTP endpoints always did", async () => {
    const tree = await trashTree(world, ada, "B3");
    const { auth: editor } = await apiToken(world, ada, {
      name: "editor",
      permissions: ["read", "edit"],
    });
    const asEditor = (method: "PATCH" | "POST", path: string, body: unknown) =>
      call(world.server, editor, method, `${notesApi}${path}`, body);
    expect((await asEditor("PATCH", `/folders/${tree.web}`, { name: "W" })).status).toBe(200);
    const move = await asEditor("POST", `/folders/${tree.web}/move`, { parentId: null });
    expect(move.body).toMatchObject({ error: "forbidden", permission: "move" });
  });
});
