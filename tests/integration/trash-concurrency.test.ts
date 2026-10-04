import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
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

// The trash racing other writes. Whatever wins, the rows never end up with
// a note or folder in use inside a folder in the trash, every request gets
// an answer (no 500), and every note change has its revision.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const send = (method: "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, ada, method, `${notesApi}${path}`, body);

// Items in use whose folder is in the trash; must stay empty.
async function strays(db: TestDatabase) {
  return db.sql`
    select 'note' as kind, n.id from notes n join folders f on f.id = n.folder_id
    where n.deleted_at is null and f.deleted_at is not null
    union all
    select 'folder', c.id from folders c join folders p on p.id = c.parent_id
    where c.deleted_at is null and p.deleted_at is not null`;
}

async function versionsWithoutRevision(db: TestDatabase) {
  return db.sql`
    select n.id from notes n where not exists (
      select 1 from note_revisions r where r.note_id = n.id and r.version = n.version)`;
}

// A write that lost the race to the trash finds the folder in the trash
// (folder_in_trash) - or, very rarely, not at all (folder_not_found).
function expectDoneOrRefused(
  result: { status: number; body: Record<string, unknown> },
  ok: number,
) {
  if (result.status === ok) return;
  expect([409, 404]).toContain(result.status);
  expect(["folder_in_trash", "folder_not_found"]).toContain(result.body.error);
}

const ROUNDS = 6;

describe("racing the trash", () => {
  it("creating notes and folders inside a folder while it goes to the trash", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const top = await createFolder(world, ada, `Race${round}`);
      const sub = await createFolder(world, ada, "Sub", top);
      const results = await Promise.all([
        send("DELETE", `/folders/${top}`),
        ...Array.from({ length: 4 }, (_, i) =>
          send("POST", "/notes", { folderId: sub, title: `Note ${i}`, body: "" }),
        ),
        send("POST", "/folders", { name: "Late", parentId: sub }),
      ]);
      for (const result of results.slice(1)) expectDoneOrRefused(result, 201);
      expect(results[0]?.status).toBe(200);
      // What was created before the deletion went with it; later ones were refused.
      const created = results.slice(1).filter((result) => result.status === 201).length;
      const [inTrash] = await world.db.sql`
        select (select count(*)::int from notes where folder_id = ${sub}
            and trash_batch_id = ${results[0]?.body.batchId as string}) +
          (select count(*)::int from folders where parent_id = ${sub}
            and trash_batch_id = ${results[0]?.body.batchId as string}) as n`;
      expect(inTrash?.n).toBe(created);
    }
    expect(await strays(world.db)).toEqual([]);
    expect(await versionsWithoutRevision(world.db)).toEqual([]);
  });

  it("restoring a note while its folder goes to the trash", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const folder = await createFolder(world, ada, `Restore${round}`);
      const note = await createNote(world, ada, { folderId: folder, title: "N", body: "" });
      await send("DELETE", `/notes/${note}`, { expectedVersion: 1 });
      const [restore, trash] = await Promise.all([
        send("POST", `/notes/${note}/restore`),
        send("DELETE", `/folders/${folder}`),
      ]);
      expect(trash?.status).toBe(200);
      // Either the note came back first and went along with the folder, or
      // it waited and found its folder in the trash.
      if (restore?.status === 200) {
        expect(trash?.body.noteCount).toBe(1);
      } else {
        expect(restore?.body).toMatchObject({ error: "parent_in_trash", folderId: folder });
      }
      const [row] = await world.db
        .sql`select deleted_at is not null as gone from notes where id = ${note}`;
      expect(row?.gone).toBe(true);
    }
    expect(await strays(world.db)).toEqual([]);
  });

  it("moving notes and folders into a subtree while it goes to the trash", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const top = await createFolder(world, ada, `Move${round}`);
      const target = await createFolder(world, ada, "Target", top);
      const elsewhere = await createFolder(world, ada, `Elsewhere${round}`);
      const notes = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          createNote(world, ada, { folderId: elsewhere, title: `M${i}`, body: "" }),
        ),
      );
      const wanderer = await createFolder(world, ada, "Wanderer", elsewhere);
      const results = await Promise.all([
        send("DELETE", `/folders/${top}`),
        ...notes.map((id) =>
          send("POST", `/notes/${id}/move`, { expectedVersion: 1, folderId: target }),
        ),
        send("POST", `/folders/${wanderer}/move`, { parentId: target }),
      ]);
      expect(results[0]?.status).toBe(200);
      for (const result of results.slice(1)) expectDoneOrRefused(result, 200);
    }
    expect(await strays(world.db)).toEqual([]);
    expect(await versionsWithoutRevision(world.db)).toEqual([]);
  });

  it("(the check above finds a note in use inside a folder in the trash)", async () => {
    const folder = await createFolder(world, ada, "Probe");
    const note = await createNote(world, ada, { folderId: folder, title: "Probe", body: "" });
    await world.db.sql`update folders set deleted_at = now(), deleted_by_name = 'probe',
      trash_batch_id = gen_random_uuid() where id = ${folder}`;
    expect(await strays(world.db)).toEqual([{ kind: "note", id: note }]);
    // Put back: the probe leaves nothing behind.
    await world.db.sql`update folders set deleted_at = null, deleted_by_name = null,
      trash_batch_id = null where id = ${folder}`;
    expect(await strays(world.db)).toEqual([]);
  });
});
