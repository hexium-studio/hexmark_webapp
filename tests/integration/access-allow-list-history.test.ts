import { beforeAll, describe, expect, it } from "vitest";
import { type AllowListWorld, allowListWorld, note, WORD } from "./access-harness";
import { tool } from "./mcp-harness";
import { apiToken, call, createNote, notesApi } from "./notes-api-harness";

// What an allow_list token learns of what lies outside its targets through
// history, the trash and the overview: nothing (access-harness.ts has the
// wiki and the token).

let world: AllowListWorld["world"];
let ada: AllowListWorld["ada"];
let agent: AllowListWorld["agent"];
let mcp: AllowListWorld["mcp"];
let ids: AllowListWorld["ids"];

beforeAll(async () => {
  ({ world, ada, agent, mcp, ids } = await allowListWorld());
});

const get = (path: string) => call(world.server, agent, "GET", `${notesApi}${path}`);
const _post = (path: string, body: unknown) =>
  call(world.server, agent, "POST", `${notesApi}${path}`, body);

describe("allow_list: history, trash and overview", () => {
  it("does not show where a note was outside its targets, nor changes outside them", async () => {
    const moved = await createNote(world, ada, note("Wanderer", ids.private));
    await call(world.server, ada, "POST", `${notesApi}/notes/${moved}/move`, {
      expectedVersion: 1,
      folderId: ids.deep,
    });
    const revisions = (await get(`/notes/${moved}/revisions`)).body.revisions as unknown[];
    expect(revisions).toMatchObject([
      { version: 2, folderId: ids.deep, folderPath: "Shared/Deep", folderOutsideScope: false },
      { version: 1, folderId: null, folderPath: null, folderOutsideScope: true },
    ]);
    const changes = (await get("/changes?since=2000-01-01T00:00:00Z")).body.changes as {
      noteId: string;
    }[];
    const seen = changes.map((change) => change.noteId);
    expect(seen).toContain(moved);
    expect(seen).not.toContain(ids.secret);
    expect(seen).not.toContain(ids.sharedNote);
  });

  it("does not see the trash outside its targets, nor names it by id", async () => {
    const outside = await createNote(world, ada, note("Gone outside", ids.private));
    const inside = await createNote(world, ada, note("Gone inside", ids.deeper));
    for (const id of [outside, inside]) {
      await call(world.server, ada, "DELETE", `${notesApi}/notes/${id}`, { expectedVersion: 1 });
    }
    const token = await apiToken(world, ada, {
      name: "listed-trash",
      mode: "allow_list",
      entries: [{ kind: "folder", id: ids.deep, permissions: ["read", "delete"] }],
    });
    const trash = await call(world.server, token.auth, "GET", `${notesApi}/trash`);
    const entries = (trash.body.entries as { id: string }[]).map((entry) => entry.id);
    expect(entries).toContain(inside);
    expect(entries).not.toContain(outside);
    expect((await get(`/notes/${outside}`)).body.error).toBe("not_found");
    expect((await get(`/notes/${inside}`)).body.error).toBe("in_trash");
  });

  it("tells the agent its mode and targets, and lists only those", async () => {
    const overview = await tool(mcp, "get_overview");
    expect(overview.data.access).toMatchObject({
      mode: "allow_list",
      permissions: ["read", "search", "create", "edit", "move"],
      entries: [
        { kind: "note", id: ids.lonely, path: "Private/Inner/Lonely", permissions: ["read"] },
        { kind: "folder", id: ids.deep, path: "Shared/Deep" },
      ],
    });
    expect(JSON.stringify(overview.data.tree)).not.toContain("Secret");
    const listed = await tool(mcp, "list_folder");
    expect((listed.data.folders as { id: string }[]).map((folder) => folder.id)).toEqual([
      ids.deep,
    ]);
    const searched = await tool(mcp, "search_notes", { query: WORD, limit: 50 });
    const found = (searched.data.hits as { noteId: string }[]).map((hit) => hit.noteId);
    expect(found).not.toContain(ids.secret);
    expect(found).toContain(ids.lonely);
  });
});
