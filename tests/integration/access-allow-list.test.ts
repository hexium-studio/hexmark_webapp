import { beforeAll, describe, expect, it } from "vitest";
import { type AllowListWorld, allowListWorld, note, WORD } from "./access-harness";
import { tool } from "./mcp-harness";
import { call, notesApi } from "./notes-api-harness";

// An allow_list token sees only its listed targets - a folder at any depth
// with everything below it, a single note - with the permissions of each
// entry, and nothing else: tree, reads, search, addressing by title (also
// the candidates of an ambiguous title), over HTTP and MCP. Nothing can be
// created at the root level. History, trash and overview:
// access-allow-list-history.test.ts.

let world: AllowListWorld["world"];
let agent: AllowListWorld["agent"];
let mcp: AllowListWorld["mcp"];
let ids: AllowListWorld["ids"];

beforeAll(async () => {
  ({ world, agent, mcp, ids } = await allowListWorld());
});

const get = (path: string) => call(world.server, agent, "GET", `${notesApi}${path}`);
const post = (path: string, body: unknown) =>
  call(world.server, agent, "POST", `${notesApi}${path}`, body);

describe("allow_list: what it sees", () => {
  it("lists at the top only the listed folder and the single note, with its folder's path", async () => {
    const root = await get("/tree?depth=3");
    expect(root.status).toBe(200);
    expect((root.body.folders as { path: string }[]).map((folder) => folder.path)).toEqual([
      "Shared/Deep",
    ]);
    expect(root.body.notes).toMatchObject([
      { id: ids.lonely, title: "Lonely", folderPath: "Private/Inner" },
    ]);
    const text = JSON.stringify(root.body);
    for (const hidden of ["Root note", "Shared note", "Secret", ids.private, ids.twinPrivate]) {
      expect(text).not.toContain(hidden);
    }
    for (const folder of [ids.shared, ids.private, ids.inner]) {
      expect((await get(`/tree?folder=${folder}`)).body.error).toBe("folder_not_found");
    }
    expect((await get(`/tree?folder=${ids.deep}&depth=2`)).status).toBe(200);
  });

  it("reads listed notes and refuses the rest as not found", async () => {
    expect((await get(`/notes/${ids.deepNote}`)).status).toBe(200);
    const lonely = await get(`/notes/${ids.lonely}`);
    expect(lonely.body.note).toMatchObject({ path: "Private/Inner/Lonely", locked: null });
    for (const hidden of [ids.root, ids.sharedNote, ids.secret, ids.twinPrivate]) {
      expect(await get(`/notes/${hidden}`)).toMatchObject({
        status: 404,
        body: { error: "not_found" },
      });
    }
  });

  it("finds only what it may search, and a listed note with read", async () => {
    const hits = (await get(`/search?q=${WORD}&limit=50`)).body.hits as { noteId: string }[];
    expect(hits.map((hit) => hit.noteId).sort()).toEqual(
      [ids.deepNote, ids.lonely, ids.twinDeep, ids.twinDeeper].sort(),
    );
    expect((await get(`/search?q=${WORD}&folder=${ids.private}`)).body.error).toBe(
      "folder_not_found",
    );
  });

  it("resolves titles among visible notes only, also as ambiguous candidates", async () => {
    const twin = await tool(mcp, "read_note", { note: "Twin" });
    expect(twin.data).toMatchObject({ error: "ambiguous_note" });
    expect((twin.data.candidates as { path: string }[]).map((c) => c.path)).toEqual([
      "Shared/Deep/Deeper/Twin",
      "Shared/Deep/Twin",
    ]);
    expect((await tool(mcp, "read_note", { note: "Secret" })).data.error).toBe("not_found");
    expect((await tool(mcp, "read_note", { note: "Private/Twin" })).data.error).toBe("not_found");
  });

  it("holds each entry's permissions: a single note listed with read cannot be edited", async () => {
    const refused = await call(world.server, agent, "PATCH", `${notesApi}/notes/${ids.lonely}`, {
      expectedVersion: 1,
      title: "Renamed",
    });
    expect(refused).toMatchObject({
      status: 403,
      body: { error: "forbidden", permission: "edit" },
    });
    const edited = await call(world.server, agent, "PATCH", `${notesApi}/notes/${ids.deepNote}`, {
      expectedVersion: 1,
      title: "Deep note (edited)",
    });
    expect(edited.status).toBe(200);
    const [row] = await world.db.sql`select title, version from notes where id = ${ids.lonely}`;
    expect(row).toEqual({ title: "Lonely", version: 1 });
  });

  it("creates only inside a listed folder, never at the root level", async () => {
    const before = await world.db.sql`select count(*)::int as n from notes`;
    for (const folderId of [null, ids.shared, ids.private]) {
      const refused = await post("/notes", note("New", folderId));
      expect(refused).toMatchObject({ status: 403, body: { reason: "outside_scope" } });
    }
    expect((await post("/folders", { name: "New", parentId: null })).body.reason).toBe(
      "outside_scope",
    );
    expect(await world.db.sql`select count(*)::int as n from notes`).toEqual(before);
    expect((await post("/notes", note("New", ids.deeper))).status).toBe(201);
    // Moving out of what it reaches is refused like creating there.
    const moved = await post(`/notes/${ids.twinDeep}/move`, { expectedVersion: 1, folderId: null });
    expect(moved).toMatchObject({ status: 403, body: { reason: "outside_scope" } });
  });
});
