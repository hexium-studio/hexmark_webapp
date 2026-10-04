import { beforeAll, describe, expect, it } from "vitest";
import { oneEvent } from "./audit-log-harness";
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

// Locks over the HTTP API: agents (API tokens) with the lock permission lock
// with a reason; a locked note or folder - and everything below a locked
// folder, also what is created there later - cannot be changed by agents
// (423 locked naming the item holding the lock), while people can; only
// people unlock. Every attempt is logged.

let world: NotesWorld;
let ada: Auth;
let agent: Auth;
let agentId: string;
let noLock: Auth;

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
  ({ auth: noLock } = await apiToken(world, ada, {
    name: "no-lock",
    mode: "deny_list",
    basePermissions: ALL.filter((permission) => permission !== "lock"),
  }));
});

describe("locking a note", () => {
  it("needs the lock permission and, for an agent, a reason", async () => {
    const id = await createNote(world, ada, { folderId: null, title: "Plain", body: "x" });
    expect(await api(noLock, "POST", `/notes/${id}/lock`, { reason: "r" })).toMatchObject({
      status: 403,
      body: { permission: "lock" },
    });
    expect((await api(agent, "POST", `/notes/${id}/lock`, {})).body).toEqual({
      error: "validation",
      fields: { reason: { code: "required" } },
    });
    expect(await noteRow(id)).toMatchObject({ locked_at: null, lock_reason: null });
  });

  it("locks with the agent as locker, and keeps the agent from every change", async () => {
    const folder = await createFolder(world, ada, "Docs");
    const id = await createNote(world, ada, {
      folderId: folder,
      title: "Final",
      body: "# A\n\nx\n",
    });
    expect(await noteRow(id)).toMatchObject({ locked_at: null, locked_by_name: null });
    const { result, event } = await oneEvent(world.db, () =>
      api(agent, "POST", `/notes/${id}/lock`, { reason: "Approved text" }),
    );
    expect((result as { body: unknown }).body).toMatchObject({
      kind: "note",
      id,
      path: "Docs/Final",
      changed: true,
      locked: { by: "locker", reason: "Approved text", inherited: false },
    });
    expect(await noteRow(id)).toMatchObject({
      version: 1,
      locked_by_name: "locker",
      locked_by_token_id: agentId,
      locked_by_user_id: null,
      lock_reason: "Approved text",
    });
    expect(event).toMatchObject({
      action: "note.locked",
      outcome: "success",
      actor_name: "locker",
      reason: "Approved text",
      target_id: id,
    });
    const locked = {
      status: 423,
      body: {
        error: "locked",
        lockedItem: { kind: "note", id, path: "Docs/Final" },
        lockedBy: "locker",
        reason: "Approved text",
      },
    };
    const v = { expectedVersion: 1 };
    expect(await api(agent, "PATCH", `/notes/${id}`, { ...v, title: "Changed" })).toMatchObject(
      locked,
    );
    expect(
      await api(agent, "PUT", `/notes/${id}/sections`, { ...v, heading: "A", body: "# A\n\ny\n" }),
    ).toMatchObject(locked);
    expect(await api(agent, "POST", `/notes/${id}/move`, { ...v, folderId: null })).toMatchObject(
      locked,
    );
    expect(await api(agent, "DELETE", `/notes/${id}`, v)).toMatchObject(locked);
    expect(await noteRow(id)).toMatchObject({
      title: "Final",
      version: 1,
      folder_id: folder,
      deleted_at: null,
    });
    // Reading is fine, and shows the lock.
    const read = await api(agent, "GET", `/notes/${id}`);
    expect(read.body.note).toMatchObject({
      locked: { inherited: false, from: { kind: "note", id } },
    });
    // People may still change it.
    expect((await api(ada, "PATCH", `/notes/${id}`, { ...v, title: "Final (ada)" })).status).toBe(
      200,
    );
    // The refusal is logged with what refused it.
    const failure = await oneEvent(world.db, () =>
      api(agent, "PATCH", `/notes/${id}`, { expectedVersion: 2, title: "x" }),
    );
    expect(failure.event).toMatchObject({
      action: "note.updated",
      outcome: "failure",
      error_code: "locked",
      details: { refusal: { lockedItem: { kind: "note", id }, lockedBy: "locker" } },
    });
  });
});

describe("unlocking", () => {
  it("is for people only; afterwards agents can change it again", async () => {
    const id = await createNote(world, ada, { folderId: null, title: "Unlock me", body: "x" });
    await api(agent, "POST", `/notes/${id}/lock`, { reason: "Hold" });
    const refused = await oneEvent(world.db, () => api(agent, "POST", `/notes/${id}/unlock`, {}));
    expect(refused.result as { status: number; body: unknown }).toMatchObject({
      status: 403,
      body: { reason: "session_required" },
    });
    expect(refused.event).toMatchObject({
      action: "note.unlocked",
      outcome: "failure",
      error_code: "forbidden",
    });
    expect(await noteRow(id)).toMatchObject({ lock_reason: "Hold" });
    const { result, event } = await oneEvent(world.db, () =>
      api(ada, "POST", `/notes/${id}/unlock`, { reason: "Done" }),
    );
    expect((result as { body: unknown }).body).toMatchObject({ changed: true, locked: null });
    expect(event).toMatchObject({
      action: "note.unlocked",
      actor_name: "ada",
      reason: "Done",
      details: { changed: true, lockedBy: "locker", lockReason: "Hold" },
    });
    expect(await noteRow(id)).toMatchObject({
      locked_at: null,
      locked_by_name: null,
      locked_by_token_id: null,
      lock_reason: null,
    });
    expect(
      (await api(agent, "PATCH", `/notes/${id}`, { expectedVersion: 1, title: "Free" })).status,
    ).toBe(200);
    // Unlocking what has no lock of its own changes nothing.
    expect((await api(ada, "POST", `/notes/${id}/unlock`, {})).body).toMatchObject({
      changed: false,
    });
  });
});
describe("unlocking a folder and listing locks as an agent", () => {
  it("lifts a folder's lock for everything below it; an agent's listing is logged", async () => {
    const shelf = await createFolder(world, ada, "Shelf");
    const book = await createNote(world, ada, { folderId: shelf, title: "Book", body: "x" });
    await api(agent, "POST", `/folders/${shelf}/lock`, { reason: "Shelved" });
    const listing = await oneEvent(world.db, () => api(agent, "GET", "/locked"));
    expect(listing.event).toMatchObject({ action: "read.locked", actor_name: "locker" });
    const items = (listing.result as { body: { items: { id: string }[] } }).body.items;
    expect(items.map((item) => item.id)).toContain(shelf);
    expect((await api(agent, "POST", `/folders/${shelf}/unlock`, {})).status).toBe(403);
    const unlocked = await api(ada, "POST", `/folders/${shelf}/unlock`, {});
    expect(unlocked.body).toMatchObject({ kind: "folder", id: shelf, changed: true, locked: null });
    const [row] = await world.db.sql`
      select locked_at, locked_by_name, lock_reason from folders where id = ${shelf}`;
    expect(row).toEqual({ locked_at: null, locked_by_name: null, lock_reason: null });
    expect(
      (await api(agent, "PATCH", `/notes/${book}`, { expectedVersion: 1, body: "y" })).status,
    ).toBe(200);
  });
});
