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

// A deny_list token sees the whole wiki except its excluded targets (a
// folder with everything below it, a single note), with one set of
// permissions; new content is included unless it lands below an excluded
// folder. Excluded items are invisible like anything out of reach.

let world: NotesWorld;
let ada: Auth;
let agent: Auth;
const ids = {} as Record<
  "hidden" | "inner" | "open" | "private" | "secret" | "shared" | "twinPrivate" | "twinShared",
  string
>;

const WORD = "quokkafish";
const note = (title: string, folderId: string | null) => ({
  folderId,
  title,
  body: `# ${title}\n\nA ${WORD} swims by.\n`,
});

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  ids.shared = await createFolder(world, ada, "Shared");
  ids.private = await createFolder(world, ada, "Private");
  ids.inner = await createFolder(world, ada, "Inner", ids.private);
  ids.open = await createNote(world, ada, note("Open", ids.shared));
  ids.hidden = await createNote(world, ada, note("Hidden note", ids.shared));
  ids.secret = await createNote(world, ada, note("Secret", ids.inner));
  ids.twinShared = await createNote(world, ada, note("Twin", ids.shared));
  ids.twinPrivate = await createNote(world, ada, note("Twin", ids.private));
  ({ auth: agent } = await apiToken(world, ada, {
    name: "except",
    mode: "deny_list",
    basePermissions: ["read", "search", "create", "edit", "move", "delete"],
    entries: [
      { kind: "folder", id: ids.private },
      { kind: "note", id: ids.hidden },
    ],
  }));
});

const get = (path: string) => call(world.server, agent, "GET", `${notesApi}${path}`);
const send = (method: "POST" | "PATCH" | "DELETE", path: string, body: unknown) =>
  call(world.server, agent, method, `${notesApi}${path}`, body);

describe("deny_list: everything except", () => {
  it("lists everything but the excluded folder and note", async () => {
    const root = await get("/tree?depth=3");
    const text = JSON.stringify(root.body);
    expect(text).toContain("Shared");
    expect(text).toContain(ids.open);
    for (const hidden of ["Private", "Hidden note", "Secret", ids.twinPrivate]) {
      expect(text).not.toContain(hidden);
    }
    expect((await get(`/tree?folder=${ids.inner}`)).body.error).toBe("folder_not_found");
    const shared = await get(`/tree?folder=${ids.shared}`);
    expect((shared.body.notes as { id: string }[]).map((entry) => entry.id).sort()).toEqual(
      [ids.open, ids.twinShared].sort(),
    );
  });

  it("does not read, find or resolve excluded notes", async () => {
    for (const id of [ids.hidden, ids.secret, ids.twinPrivate]) {
      expect((await get(`/notes/${id}`)).body.error).toBe("not_found");
    }
    const hits = (await get(`/search?q=${WORD}&limit=50`)).body.hits as { noteId: string }[];
    expect(hits.map((hit) => hit.noteId).sort()).toEqual([ids.open, ids.twinShared].sort());
    // "Twin" names two notes, but one is excluded: no ambiguity, no candidate.
    const twin = await get(`/search?q=Twin&limit=50`);
    expect(JSON.stringify(twin.body)).not.toContain(ids.twinPrivate);
  });

  it("includes new content automatically unless it lands in an excluded folder", async () => {
    const later = await createFolder(world, ada, "Later");
    const laterNote = await createNote(world, ada, note("Later note", later));
    const below = await createNote(world, ada, note("Below", ids.inner));
    expect((await get(`/notes/${laterNote}`)).status).toBe(200);
    expect((await get(`/notes/${below}`)).body.error).toBe("not_found");
    const listed = JSON.stringify((await get("/tree")).body);
    expect(listed).toContain(later);
  });

  it("creates at the root level, but never inside an excluded folder", async () => {
    expect((await send("POST", "/notes", note("At root", null))).status).toBe(201);
    const refused = await send("POST", "/notes", note("Inside", ids.inner));
    expect(refused).toMatchObject({ status: 403, body: { reason: "outside_scope" } });
    const moved = await send("POST", `/notes/${ids.open}/move`, {
      expectedVersion: 1,
      folderId: ids.private,
    });
    expect(moved).toMatchObject({ status: 403, body: { reason: "outside_scope" } });
    const [row] = await world.db.sql`select folder_id, version from notes where id = ${ids.open}`;
    expect(row).toEqual({ folder_id: ids.shared, version: 1 });
  });

  it("cannot move a folder with an excluded note to the trash", async () => {
    const refused = await send("DELETE", `/folders/${ids.shared}`, {});
    expect(refused).toMatchObject({ status: 403, body: { reason: "hidden_content" } });
    const rows = await world.db.sql`
      select count(*)::int as n from notes where folder_id = ${ids.shared} and deleted_at is not null`;
    expect(rows).toEqual([{ n: 0 }]);
    const [folder] = await world.db.sql`select deleted_at from folders where id = ${ids.shared}`;
    expect(folder?.deleted_at).toBeNull();
    // A folder without excluded content goes.
    const empty = await createFolder(world, ada, "Empty");
    await createNote(world, ada, note("Inside empty", empty));
    expect((await send("DELETE", `/folders/${empty}`, {})).status).toBe(200);
  });

  it("does not see the excluded parts of the trash or the changes", async () => {
    const gone = await createNote(world, ada, note("Gone", ids.inner));
    await call(world.server, ada, "DELETE", `${notesApi}/notes/${gone}`, { expectedVersion: 1 });
    const trash = await get("/trash");
    expect(JSON.stringify(trash.body)).not.toContain(gone);
    expect((await get(`/notes/${gone}`)).body.error).toBe("not_found");
    const changes = JSON.stringify((await get("/changes?since=2000-01-01T00:00:00Z")).body);
    expect(changes).toContain(ids.open);
    for (const hidden of [gone, ids.hidden, ids.secret]) expect(changes).not.toContain(hidden);
  });
});
