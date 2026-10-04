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
import { tableCounts, trashApi, trashRows, trashTree } from "./trash-harness";

// Deleting from the trash for good over HTTP: signed-in people only, never
// an API token (403, decided by the service on the locked session or token
// row), emptying the whole trash for administrators only. A note goes with
// its revisions and sections; nothing in use is touched.

let world: NotesWorld;
let ada: Auth;
let root: Auth;
let agent: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  ({ auth: root } = await signedIn(world, "root", "admin"));
  ({ auth: agent } = await apiToken(world, root, {
    name: "cleaner",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  }));
});

const send = (auth: Auth, method: "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, auth, method, `${notesApi}${path}`, body);

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("API tokens", () => {
  it("are refused with 403 on every endpoint that deletes for good, and nothing goes", async () => {
    const tree = await trashTree(world, ada, "T1");
    await send(ada, "DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    await send(ada, "DELETE", `/folders/${tree.web}`);
    const before = await tableCounts(world.db);

    for (const path of [`/notes/${tree.plan}`, `/folders/${tree.web}`, ""]) {
      const refused = await call(world.server, agent, "DELETE", `${trashApi}${path}`);
      expect(refused, path).toMatchObject({
        status: 403,
        body: { error: "forbidden", reason: "session_required" },
      });
    }
    expect(await tableCounts(world.db)).toEqual(before);
    // The same token may still move to the trash and restore (the case that must work).
    const restored = await send(agent, "POST", `/folders/${tree.web}/restore`);
    expect(restored.status).toBe(200);
  });

  it("without the delete permission are refused for that first", async () => {
    const { auth: reader } = await apiToken(world, root, { name: "reader", permissions: ["read"] });
    const refused = await call(world.server, reader, "DELETE", `${trashApi}/notes/${UNKNOWN}`);
    expect(refused.body).toMatchObject({ error: "forbidden", permission: "delete" });
  });
});

describe("signed-in people", () => {
  it("delete a note in the trash for good, with its revisions and sections", async () => {
    const tree = await trashTree(world, ada, "T2");
    const live = await call(world.server, ada, "DELETE", `${trashApi}/notes/${tree.spec}`);
    expect(live).toMatchObject({ status: 409, body: { error: "note_not_deleted" } });
    await send(ada, "DELETE", `/notes/${tree.spec}`, { expectedVersion: 1 });
    const [owned] = await world.db.sql`
      select (select count(*)::int from note_revisions where note_id = ${tree.spec}) as revisions,
        (select count(*)::int from note_sections where note_id = ${tree.spec}) as sections`;
    expect(owned).toEqual({ revisions: 2, sections: 1 });
    const before = await tableCounts(world.db);

    const removed = await call(world.server, ada, "DELETE", `${trashApi}/notes/${tree.spec}`);
    expect(removed).toMatchObject({ status: 200, body: { notes: 1, folders: 0 } });
    expect(await tableCounts(world.db)).toEqual({
      ...before,
      notes: before.notes - 1,
      notes_in_trash: before.notes_in_trash - 1,
      revisions: before.revisions - 2,
      sections: before.sections - 1,
    });
    const gone = await call(world.server, ada, "DELETE", `${trashApi}/notes/${tree.spec}`);
    expect(gone.status).toBe(404);
  });

  it("delete a folder for good with everything of it in the trash", async () => {
    const tree = await trashTree(world, ada, "T3");
    const live = await call(world.server, ada, "DELETE", `${trashApi}/folders/${tree.web}`);
    expect(live).toMatchObject({ status: 409, body: { error: "folder_not_deleted" } });
    await send(ada, "DELETE", `/notes/${tree.draft}`, { expectedVersion: 1 });
    await send(ada, "DELETE", `/folders/${tree.web}`);
    const before = await tableCounts(world.db);

    const removed = await call(world.server, ada, "DELETE", `${trashApi}/folders/${tree.web}`);
    expect(removed).toMatchObject({ status: 200, body: { notes: 2, folders: 2 } });
    const left = await world.db.sql`
      select id from folders where id in (${tree.web}, ${tree.old})
      union all select id from notes where id in (${tree.spec}, ${tree.draft})`;
    expect(left).toEqual([]);
    // The folder above and its note are untouched.
    expect(await trashRows(world.db, "folders", [tree.projects])).toMatchObject([
      { inTrash: false },
    ]);
    expect(await trashRows(world.db, "notes", [tree.plan])).toMatchObject([
      { inTrash: false, version: 1 },
    ]);
    const after = await tableCounts(world.db);
    expect([after.notes, after.folders]).toEqual([before.notes - 2, before.folders - 2]);
  });
});

describe("emptying the trash", () => {
  it("is for administrators only and removes everything in the trash, nothing else", async () => {
    const tree = await trashTree(world, ada, "T4");
    await send(ada, "DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    await send(ada, "DELETE", `/folders/${tree.web}`);
    const refused = await call(world.server, ada, "DELETE", trashApi);
    expect(refused).toMatchObject({
      status: 403,
      body: { error: "forbidden", reason: "admin_required" },
    });
    const before = await tableCounts(world.db);
    expect(before.notes_in_trash).toBeGreaterThan(0);
    expect(before.folders_in_trash).toBeGreaterThan(0);
    const liveNotes = await world.db.sql`
      select id, version from notes where deleted_at is null order by id`;
    expect(liveNotes.length).toBeGreaterThan(0);

    const emptied = await call(world.server, root, "DELETE", trashApi);
    expect(emptied).toMatchObject({
      status: 200,
      body: { notes: before.notes_in_trash, folders: before.folders_in_trash },
    });
    const after = await tableCounts(world.db);
    expect(after).toMatchObject({
      notes: before.notes - before.notes_in_trash,
      folders: before.folders - before.folders_in_trash,
      notes_in_trash: 0,
      folders_in_trash: 0,
    });
    expect(
      await world.db.sql`select id, version from notes where deleted_at is null order by id`,
    ).toEqual(liveNotes);
  });
});
