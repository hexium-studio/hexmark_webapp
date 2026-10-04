import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// Requests racing each other: the database rows decide, so exactly one of
// several writes based on the same version wins, a title is taken once, and
// two folder moves cannot form a cycle together.

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

const PARALLEL = 8;

describe("racing writes", () => {
  it("lets exactly one of several writes on the same version through", async () => {
    const id = await createNote(world, ada, { title: "Race", body: "start" });
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        call(world.server, ada, "PATCH", `${notesApi}/notes/${id}`, {
          expectedVersion: 1,
          body: `writer ${i}`,
        }),
      ),
    );
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, ...Array(PARALLEL - 1).fill(409)]);
    const rows = await revisionRows(world.db, id);
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    const winner = results.find((result) => result.status === 200);
    const [note] = await world.db.sql`select version from notes where id = ${id}`;
    expect(note?.version).toBe(winner?.body.version);
  });

  it("creates a title only once when several requests want it", async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        call(world.server, ada, "POST", `${notesApi}/notes`, { title: "Unique", body: "" }),
      ),
    );
    const errors = results.filter((result) => result.status !== 201).map((r) => r.body.error);
    expect(errors).toEqual(Array(PARALLEL - 1).fill("title_taken"));
    const [count] = await world.db.sql`select count(*)::int as n from notes where title = 'Unique'`;
    expect(count?.n).toBe(1);
  });

  it("refuses one of two moves that would together form a cycle", async () => {
    for (let round = 0; round < 5; round++) {
      const a = await createFolder(world, ada, `A${round}`);
      const b = await createFolder(world, ada, `B${round}`);
      const [first, second] = await Promise.all([
        call(world.server, ada, "POST", `${notesApi}/folders/${a}/move`, { parentId: b }),
        call(world.server, ada, "POST", `${notesApi}/folders/${b}/move`, { parentId: a }),
      ]);
      expect([first?.status, second?.status].sort()).toEqual([200, 409]);
      const rows = await world.db.sql`
        select count(*)::int as n from folders where id in (${a}, ${b}) and parent_id is null`;
      expect(rows[0]?.n).toBe(1);
    }
  });
});
