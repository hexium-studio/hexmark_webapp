import { setTimeout as sleep } from "node:timers/promises";
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

// An agent's write is decided on the folder rows it locks, not on the
// folder tree it read at its start: a folder moved below an excluded folder,
// or locked, by a transaction that commits while the write waits for that
// row, refuses the write. The test holds such a transaction open, sends the
// write, then commits.

let world: NotesWorld;
let ada: Auth;
const ALL = ["read", "search", "create", "edit", "move", "delete", "lock"];

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
});

// Runs `change` in a transaction that stays open while `write` is sent,
// and commits it a moment later; returns the write's answer.
async function whileChanging(change: string, params: unknown[], write: () => Promise<unknown>) {
  let answer: Promise<unknown> | undefined;
  await world.db.sql.begin(async (sql) => {
    await sql.unsafe(change, params as never[]);
    answer = write();
    await sleep(400);
  });
  return answer;
}

describe("racing a write", () => {
  it("a folder moved below an excluded one meanwhile: not found", async () => {
    const excluded = await createFolder(world, ada, "Excluded");
    const moving = await createFolder(world, ada, "Moving");
    const id = await createNote(world, ada, { folderId: moving, title: "Inside", body: "x" });
    const { auth } = await apiToken(world, ada, {
      name: "racer",
      mode: "deny_list",
      basePermissions: ALL,
      entries: [{ kind: "folder", id: excluded }],
    });
    const answer = await whileChanging(
      "update folders set parent_id = $1 where id = $2",
      [excluded, moving],
      () =>
        call(world.server, auth, "PATCH", `${notesApi}/notes/${id}`, {
          expectedVersion: 1,
          title: "Changed",
        }),
    );
    expect(answer).toMatchObject({ status: 404, body: { error: "not_found" } });
    const [row] = await world.db.sql`select title, version from notes where id = ${id}`;
    expect(row).toEqual({ title: "Inside", version: 1 });
  });

  it("a folder locked meanwhile: locked", async () => {
    const shelf = await createFolder(world, ada, "Shelf");
    const id = await createNote(world, ada, { folderId: shelf, title: "Book", body: "x" });
    const { auth } = await apiToken(world, ada, {
      name: "racer-2",
      mode: "deny_list",
      basePermissions: ALL,
    });
    const answer = await whileChanging(
      `update folders set locked_at = now(), locked_by_name = 'ada', lock_reason = 'Hold'
        where id = $1`,
      [shelf],
      () =>
        call(world.server, auth, "PATCH", `${notesApi}/notes/${id}`, {
          expectedVersion: 1,
          title: "Changed",
        }),
    );
    expect(answer).toMatchObject({
      status: 423,
      body: { error: "locked", lockedItem: { kind: "folder", id: shelf, path: "Shelf" } },
    });
    const [row] = await world.db.sql`select title, version from notes where id = ${id}`;
    expect(row).toEqual({ title: "Book", version: 1 });
    // The same write without the race goes through once unlocked.
    await call(world.server, ada, "POST", `${notesApi}/folders/${shelf}/unlock`, {});
    const free = await call(world.server, auth, "PATCH", `${notesApi}/notes/${id}`, {
      expectedVersion: 1,
      title: "Changed",
    });
    expect(free.status).toBe(200);
  });
});
