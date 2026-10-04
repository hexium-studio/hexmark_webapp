import { setTimeout as sleep } from "node:timers/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { ALL } from "./hidden-harness";
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

// An agent's write is decided on the rows it locks, also for hidden marks: a
// folder above hidden, the target folder hidden or the note itself hidden by
// a transaction that commits while the write waits for that row refuses the
// write - not found below a hidden folder, hidden otherwise. The test holds
// such a transaction open, sends the write, then commits. A write on another
// note still goes through (the check measures the race, not a blanket ban).

let world: NotesWorld;
let ada: Auth;
let agent: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  ({ auth: agent } = await apiToken(world, ada, {
    name: "racer",
    mode: "deny_list",
    basePermissions: ALL,
  }));
});

const HIDE = "set hidden_at = now(), hidden_by_name = 'ada', hide_reason = 'Hold'";

async function whileChanging(change: string, params: unknown[], write: () => Promise<unknown>) {
  let answer: Promise<unknown> | undefined;
  await world.db.sql.begin(async (sql) => {
    await sql.unsafe(change, params as never[]);
    answer = write();
    await sleep(400);
  });
  return answer;
}

const rename = (id: string, title: string) =>
  call(world.server, agent, "PATCH", `${notesApi}/notes/${id}`, { expectedVersion: 1, title });
const noteRow = async (id: string) =>
  (await world.db.sql`select title, version from notes where id = ${id}`)[0];

describe("racing an agent's write with hiding", () => {
  it("a folder above hidden meanwhile: not found", async () => {
    const shelf = await createFolder(world, ada, "Shelf");
    const id = await createNote(world, ada, { folderId: shelf, title: "Book", body: "x" });
    const answer = await whileChanging(`update folders ${HIDE} where id = $1`, [shelf], () =>
      rename(id, "Changed"),
    );
    expect(answer).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await noteRow(id)).toEqual({ title: "Book", version: 1 });
  });

  it("the note hidden meanwhile: hidden", async () => {
    const id = await createNote(world, ada, { folderId: null, title: "Letter", body: "x" });
    const answer = await whileChanging(`update notes ${HIDE} where id = $1`, [id], () =>
      rename(id, "Changed"),
    );
    expect(answer).toMatchObject({ status: 403, body: { error: "hidden", hiddenItem: { id } } });
    expect(await noteRow(id)).toEqual({ title: "Letter", version: 1 });
  });

  it("the target folder hidden meanwhile: hidden, nothing created", async () => {
    const box = await createFolder(world, ada, "Box");
    const answer = await whileChanging(`update folders ${HIDE} where id = $1`, [box], () =>
      call(world.server, agent, "POST", `${notesApi}/notes`, {
        folderId: box,
        title: "Racer",
        body: "x",
      }),
    );
    expect(answer).toMatchObject({
      status: 403,
      body: { error: "hidden", hiddenItem: { id: box } },
    });
    const [row] = await world.db.sql`select count(*)::int as n from notes where title = 'Racer'`;
    expect(row?.n).toBe(0);
  });

  it("another note is written as usual meanwhile", async () => {
    const other = await createFolder(world, ada, "Other");
    const free = await createNote(world, ada, { folderId: null, title: "Free", body: "x" });
    const answer = await whileChanging(`update folders ${HIDE} where id = $1`, [other], () =>
      rename(free, "Freed"),
    );
    expect(answer).toMatchObject({ status: 200, body: { version: 2 } });
    expect(await noteRow(free)).toEqual({ title: "Freed", version: 2 });
  });
});
