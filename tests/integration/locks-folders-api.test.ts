import { beforeAll, describe, expect, it } from "vitest";
import { eventsOf } from "./audit-log-harness";
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

// Folder locks over the HTTP API: a folder's lock covers everything below
// it, also what is created there later; agents cannot change any of it, nor
// delete a folder that holds a locked note (see locks-api.test.ts).

let world: NotesWorld;
let ada: Auth;
let agent: Auth;
let agentId: string;

const ALL = ["read", "search", "create", "edit", "move", "delete", "lock"];
const api = (
  auth: Auth,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => call(world.server, auth, method, `${notesApi}${path}`, body);
const noteRow = async (id: string) =>
  (
    await world.db.sql`
      select title, version, folder_id, deleted_at, locked_at, locked_by_name,
        locked_by_token_id, locked_by_user_id, lock_reason
      from notes where id = ${id}`
  )[0];

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  const created = await apiToken(world, ada, {
    name: "locker",
    mode: "deny_list",
    basePermissions: ALL,
  });
  agent = created.auth;
  agentId = created.id;
});

describe("locking a folder", () => {
  it("covers everything below it, also what is created there later", async () => {
    const top = await createFolder(world, ada, "Archive");
    const { result } = await eventsOf(world.db, () =>
      api(agent, "POST", `/folders/${top}/lock`, { reason: "Archived" }),
    );
    expect((result as { status: number }).status).toBe(200);
    const [folder] = await world.db.sql`
      select locked_by_name, lock_reason, locked_by_token_id from folders where id = ${top}`;
    expect(folder).toEqual({
      locked_by_name: "locker",
      lock_reason: "Archived",
      locked_by_token_id: agentId,
    });
    // Created later, by a person: inside the lock.
    const sub = await createFolder(world, ada, "2025", top);
    const later = await createNote(world, ada, { folderId: sub, title: "Later", body: "x" });
    const locked = {
      status: 423,
      body: { error: "locked", lockedItem: { kind: "folder", id: top, path: "Archive" } },
    };
    expect(
      await api(agent, "PATCH", `/notes/${later}`, { expectedVersion: 1, body: "y" }),
    ).toMatchObject(locked);
    expect(
      await api(agent, "POST", "/notes", { folderId: sub, title: "New", body: "x" }),
    ).toMatchObject(locked);
    expect(await api(agent, "POST", "/folders", { parentId: top, name: "New" })).toMatchObject(
      locked,
    );
    expect(await api(agent, "PATCH", `/folders/${sub}`, { name: "2026" })).toMatchObject(locked);
    expect(await api(agent, "POST", `/folders/${sub}/move`, { parentId: null })).toMatchObject(
      locked,
    );
    expect(await api(agent, "DELETE", `/folders/${sub}`, {})).toMatchObject(locked);
    expect(await api(agent, "DELETE", `/folders/${top}`, {})).toMatchObject(locked);
    // Into it from outside: also refused.
    const outside = await createNote(world, ada, { folderId: null, title: "Outside", body: "x" });
    expect(
      await api(agent, "POST", `/notes/${outside}/move`, { expectedVersion: 1, folderId: sub }),
    ).toMatchObject(locked);
    // Nothing changed.
    const rows = await world.db.sql`
      select count(*)::int as n from folders where parent_id = ${top} and deleted_at is null`;
    expect(rows).toEqual([{ n: 1 }]);
    expect(await noteRow(later)).toMatchObject({ version: 1, deleted_at: null });
    // Reads show the inherited lock.
    const read = await api(agent, "GET", `/notes/${later}`);
    expect(read.body.note).toMatchObject({
      locked: {
        inherited: true,
        reason: "Archived",
        from: { kind: "folder", id: top, path: "Archive" },
      },
    });
    const tree = await api(agent, "GET", `/tree?folder=${top}&depth=2`);
    expect(tree.body).toMatchObject({
      folder: { locked: { inherited: false } },
      folders: [
        {
          id: sub,
          locked: { inherited: true },
          notes: [{ id: later, locked: { inherited: true } }],
        },
      ],
    });
    // An agent cannot lock inside it; people may, and may change things.
    expect(await api(agent, "POST", `/notes/${later}/lock`, { reason: "x" })).toMatchObject(locked);
    expect(
      (await api(ada, "POST", "/notes", { folderId: sub, title: "By ada", body: "x" })).status,
    ).toBe(201);
    // Locking again changes nothing.
    const again = await api(agent, "POST", `/folders/${top}/lock`, { reason: "Again" });
    expect(again.body).toMatchObject({ changed: false, locked: { reason: "Archived" } });
  });

  it("keeps an agent from deleting a folder that holds a locked note, and lists locks", async () => {
    const box = await createFolder(world, ada, "Box");
    const kept = await createNote(world, ada, { folderId: box, title: "Kept", body: "x" });
    await api(ada, "POST", `/notes/${kept}/lock`, {});
    const refused = await api(agent, "DELETE", `/folders/${box}`, {});
    expect(refused).toMatchObject({
      status: 423,
      body: {
        lockedItem: { kind: "note", id: kept, path: "Box/Kept" },
        lockedBy: "ada",
        reason: null,
      },
    });
    const [folder] = await world.db.sql`select deleted_at from folders where id = ${box}`;
    expect(folder?.deleted_at).toBeNull();
    expect(await noteRow(kept)).toMatchObject({ deleted_at: null, version: 1 });
    const list = await api(ada, "GET", "/locked");
    expect(list.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "folder",
          path: "Archive",
          coveredFolders: 1,
          coveredNotes: 2,
        }),
        expect.objectContaining({ kind: "note", id: kept, path: "Box/Kept", lockedBy: "ada" }),
      ]),
    );
  });
});
