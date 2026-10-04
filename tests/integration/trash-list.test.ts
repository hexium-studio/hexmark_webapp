import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";
import { trashApi, trashTree } from "./trash-harness";

// GET /api/notes/v1/trash: what is in the trash, with original paths, who
// deleted it, when it will be purged, and for a folder deleted with its
// contents the folder alone with counts. A server with a retention of its own
// (TRASH_RETENTION_DAYS) answers with that.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld({ TRASH_RETENTION_DAYS: "7" });
  ({ auth: ada } = await signedIn(world, "ada"));
});

const send = (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

interface Entry {
  kind: string;
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  parentPath: string | null;
  deletedAt: string;
  deletedBy: string;
  purgeAt: string;
  batchId: string;
  version?: number;
  folderCount?: number;
  noteCount?: number;
}

describe("listing the trash", () => {
  it("lists batches by their folder, single deletions on their own, newest first", async () => {
    const tree = await trashTree(world, ada, "L1");
    const draft = await send("DELETE", `/notes/${tree.draft}`, { expectedVersion: 1 });
    const web = await send("DELETE", `/folders/${tree.web}`, { reason: "cleanup" });

    const listing = await call(world.server, ada, "GET", `${trashApi}?folder=${tree.projects}`);
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({ retentionDays: 7, hasMore: false });
    const entries = listing.body.entries as Entry[];
    // Web (with Old and Spec counted, not listed), then Draft deleted before it.
    expect(entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["folder", "L1/Web"],
      ["note", "L1/Web/Old/Draft"],
    ]);
    expect(entries[0]).toEqual({
      kind: "folder",
      id: tree.web,
      name: "Web",
      path: "L1/Web",
      parentId: tree.projects,
      parentPath: "L1",
      deletedAt: web.body.deletedAt,
      deletedBy: "ada",
      purgeAt: web.body.purgeAt,
      batchId: web.body.batchId,
      folderCount: 1,
      noteCount: 1,
    });
    expect(entries[1]).toEqual({
      kind: "note",
      id: tree.draft,
      name: "Draft",
      path: "L1/Web/Old/Draft",
      parentId: tree.old,
      parentPath: "L1/Web/Old",
      deletedAt: draft.body.deletedAt,
      deletedBy: "ada",
      purgeAt: draft.body.purgeAt,
      batchId: draft.body.batchId,
      version: 2,
    });
    // The server's retention: 7 days.
    const purgeIn =
      Date.parse(web.body.purgeAt as string) - Date.parse(web.body.deletedAt as string);
    expect(purgeIn).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("narrows to a folder, also one in the trash, and pages with limit", async () => {
    const tree = await trashTree(world, ada, "L2");
    await send("DELETE", `/notes/${tree.draft}`, { expectedVersion: 1 });
    await send("DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    await send("DELETE", `/folders/${tree.web}`);

    const inWeb = await call(world.server, ada, "GET", `${trashApi}?folder=${tree.web}`);
    expect((inWeb.body.entries as Entry[]).map((entry) => entry.id)).toEqual([tree.draft]);
    const all = await call(world.server, ada, "GET", `${trashApi}?folder=${tree.projects}`);
    expect((all.body.entries as Entry[]).map((entry) => entry.id)).toEqual([
      tree.web,
      tree.plan,
      tree.draft,
    ]);
    const one = await call(world.server, ada, "GET", `${trashApi}?folder=${tree.projects}&limit=1`);
    expect(one.body).toMatchObject({ hasMore: true });
    expect((one.body.entries as Entry[]).map((entry) => entry.id)).toEqual([tree.web]);

    const unknown = await call(
      world.server,
      ada,
      "GET",
      `${trashApi}?folder=00000000-0000-4000-8000-000000000000`,
    );
    expect(unknown).toMatchObject({ status: 404, body: { error: "folder_not_found" } });
    expect((await call(world.server, ada, "GET", `${trashApi}?limit=0`)).status).toBe(400);
  });

  it("needs the delete permission", async () => {
    const { auth: guest } = await signedIn(world, "gus", "guest");
    const refused = await call(world.server, guest, "GET", trashApi);
    expect(refused).toMatchObject({
      status: 403,
      body: { error: "forbidden", permission: "delete" },
    });
  });
});
