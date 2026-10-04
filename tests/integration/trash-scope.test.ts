import { beforeAll, describe, expect, it } from "vitest";
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
import { trashApi, trashRows } from "./trash-harness";

// The trash for a token limited to folders: it sees, restores and is told
// in_trash only about items that lay inside its folders, including its own
// folder when that went to the trash; everything else stays not_found.

let world: NotesWorld;
let ada: Auth;
let scoped: Auth;
let inside: string;
let child: string;
let outside: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  inside = await createFolder(world, ada, "Inside");
  child = await createFolder(world, ada, "Child", inside);
  outside = await createFolder(world, ada, "Outside");
  ({ auth: scoped } = await apiToken(world, ada, {
    name: "scoped",
    permissions: ["read", "delete"],
    folderScope: [inside],
  }));
});

const as = (auth: Auth, method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, auth, method, `${notesApi}${path}`, body);

const entryIds = (body: Record<string, unknown>) =>
  (body.entries as { id: string }[]).map((entry) => entry.id);

describe("a token limited to folders", () => {
  it("sees and restores only what lay inside its folders", async () => {
    const mine = await createNote(world, ada, { folderId: child, title: "Mine", body: "" });
    const theirs = await createNote(world, ada, { folderId: outside, title: "Theirs", body: "" });
    const atRoot = await createNote(world, ada, { title: "Root", body: "" });
    await as(ada, "DELETE", `/notes/${theirs}`, { expectedVersion: 1 });
    await as(ada, "DELETE", `/notes/${atRoot}`, { expectedVersion: 1 });
    const trashed = await as(scoped, "DELETE", `/notes/${mine}`, { expectedVersion: 1 });
    expect(trashed.status).toBe(200);
    expect((await trashRows(world.db, "notes", [mine]))[0]).toMatchObject({
      deletedByName: "scoped",
      deletedByUserId: null,
    });

    expect(entryIds((await call(world.server, scoped, "GET", trashApi)).body)).toEqual([mine]);
    const all = entryIds((await call(world.server, ada, "GET", trashApi)).body);
    expect(all).toEqual(expect.arrayContaining([mine, theirs, atRoot]));

    // Outside: not_found, as if it did not exist; inside: in_trash.
    expect((await as(scoped, "GET", `/notes/${theirs}`)).body.error).toBe("not_found");
    expect((await as(scoped, "GET", `/notes/${mine}`)).body.error).toBe("in_trash");
    const foreign = await as(scoped, "POST", `/notes/${theirs}/restore`);
    expect(foreign).toMatchObject({ status: 404, body: { error: "not_found" } });
    const outsideTarget = await as(scoped, "POST", `/notes/${mine}/restore`, {
      folderId: outside,
    });
    expect(outsideTarget.body).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    const listOutside = await call(world.server, scoped, "GET", `${trashApi}?folder=${outside}`);
    expect(listOutside.body.error).toBe("folder_not_found");
    expect((await trashRows(world.db, "notes", [theirs, mine])).map((r) => r.inTrash)).toEqual([
      true,
      true,
    ]);

    const restored = await as(scoped, "POST", `/notes/${mine}/restore`, { reason: "mine" });
    expect(restored.body).toMatchObject({ path: "Inside/Child/Mine", version: 3 });
  });

  it("still reaches its own folder after it went to the trash, and can restore it", async () => {
    const note = await createNote(world, ada, { folderId: child, title: "Kept", body: "" });
    await as(ada, "DELETE", `/folders/${inside}`, { reason: "by the owner" });
    // Nothing in use is left for it ...
    expect((await as(scoped, "GET", "/tree")).body).toMatchObject({ folders: [], notes: [] });
    // ... but the trash shows its folder, and it may bring it back.
    expect(entryIds((await call(world.server, scoped, "GET", trashApi)).body)).toContain(inside);
    const restored = await as(scoped, "POST", `/folders/${inside}/restore`, { reason: "back" });
    expect(restored).toMatchObject({
      status: 200,
      body: { path: "Inside", restoredSubfolders: 1 },
    });
    expect((await trashRows(world.db, "notes", [note]))[0]).toMatchObject({ inTrash: false });
    expect((await trashRows(world.db, "folders", [inside, child])).map((r) => r.inTrash)).toEqual([
      false,
      false,
    ]);
  });

  it("cannot delete a folder outside its folders", async () => {
    const refused = await as(scoped, "DELETE", `/folders/${outside}`);
    expect(refused).toMatchObject({ status: 404, body: { error: "folder_not_found" } });
    expect((await trashRows(world.db, "folders", [outside]))[0]?.inTrash).toBe(false);
  });

  it("is told folder_in_trash only inside its folders, and never a parent outside", async () => {
    const outsideTrash = await as(ada, "DELETE", `/folders/${outside}`);
    const insideTrash = await as(ada, "DELETE", `/folders/${inside}`);
    // Inside its folders (Child went along with Inside): in the trash, with the batch.
    const listed = await as(scoped, "GET", `/tree?folder=${child}`);
    expect(listed).toMatchObject({
      status: 409,
      body: {
        error: "folder_in_trash",
        batchId: insideTrash.body.batchId,
        deletedAt: insideTrash.body.deletedAt,
        purgeAt: insideTrash.body.purgeAt,
      },
    });
    // Outside: as if it did not exist; the owner, who may see it, is told.
    const foreign = await as(scoped, "GET", `/tree?folder=${outside}`);
    expect(foreign).toMatchObject({ status: 404, body: { error: "folder_not_found" } });
    expect(foreign.body).not.toHaveProperty("batchId");
    const owner = await as(ada, "GET", `/tree?folder=${outside}`);
    expect(owner.body).toMatchObject({
      error: "folder_in_trash",
      batchId: outsideTrash.body.batchId,
    });

    // Where Inside was: the root level, which the scoped token cannot see.
    const entry = (auth: Auth) => call(world.server, auth, "GET", trashApi);
    const find = (body: Record<string, unknown>) =>
      (body.entries as Record<string, unknown>[]).find((item) => item.id === inside);
    expect(find((await entry(scoped)).body)).toMatchObject({ parentId: null, parentPath: null });
    expect(find((await entry(ada)).body)).toMatchObject({ parentId: null, parentPath: "" });

    expect((await as(ada, "POST", `/folders/${inside}/restore`)).status).toBe(200);
    expect((await as(ada, "POST", `/folders/${outside}/restore`)).status).toBe(200);
  });
});
