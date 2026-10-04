import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// What the fifth agent test asked for, over MCP and the HTTP API:
// restore_folder counting subfolders by an unambiguous name,
// folder_in_trash (and in_trash) naming the folder, where it was and the
// folder its batch was deleted with, a hyphenated search word marked
// without its parts elsewhere, and read_revision with noteId. Folder
// creation and moves: mcp-run5-folders.test.ts.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let base: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "run-5",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  agent = await connectMcp(world.server, token.token);
  base = (await tool(agent, "create_folder", { name: "Lauf5" })).data.id as string;
});

const folder = async (name: string, parent = base) =>
  (await tool(agent, "create_folder", { parent_id: parent, name })).data.id as string;

describe("restore_folder", () => {
  it("counts the subfolders that came back, not the folder itself", async () => {
    const box = await folder("Kiste");
    await folder("Innen", box);
    await tool(agent, "create_note", { folder_id: box, title: "Inhalt", body: "x" });
    const deleted = await tool(agent, "delete_folder", { folder_id: box });
    const restored = await tool(agent, "restore_folder", { folder_id: box });
    expect(restored.data).toEqual({
      id: box,
      name: "Kiste",
      path: "Lauf5/Kiste",
      batchId: deleted.data.batchId,
      restoredSubfolders: 1,
      restoredNotes: 1,
    });
  });
});

describe("folder_in_trash and in_trash", () => {
  it("name the folder, where it was and the folder the batch went with", async () => {
    const top = await folder("Alt");
    const inner = await folder("Altlasten", top);
    const noteId = (
      await tool(agent, "create_note", { folder_id: inner, title: "Rest", body: "r" })
    ).data.id;
    const deleted = await tool(agent, "delete_folder", { folder_id: top });
    const batchId = deleted.data.batchId;

    const ofInner = await tool(agent, "list_folder", { folder_id: inner });
    expect(ofInner).toMatchObject({
      isError: true,
      data: {
        error: "folder_in_trash",
        folderId: inner,
        path: "Lauf5/Alt/Altlasten",
        batchId,
        batchRootId: top,
        batchRootPath: "Lauf5/Alt",
      },
    });
    expect(ofInner.data.message).toContain("batchRootId");

    const ofTop = await tool(agent, "create_folder", { parent_id: top, name: "Neu" });
    expect(ofTop.data).toMatchObject({
      error: "folder_in_trash",
      folderId: top,
      path: "Lauf5/Alt",
      batchId,
    });
    expect(ofTop.data).not.toHaveProperty("batchRootId");

    const ofNote = await tool(agent, "read_note", { note: noteId });
    expect(ofNote.data).toMatchObject({
      error: "in_trash",
      path: "Lauf5/Alt/Altlasten/Rest",
      batchId,
      batchRootId: top,
      batchRootPath: "Lauf5/Alt",
    });

    const overHttp = await call(world.server, ada, "GET", `${notesApi}/tree?folder=${inner}`);
    expect(overHttp).toMatchObject({
      status: 409,
      body: { error: "folder_in_trash", folderId: inner, batchRootId: top },
    });
  });

  it("leave out the batch root for a note deleted on its own", async () => {
    const id = (await tool(agent, "create_note", { folder_id: base, title: "Solo", body: "s" }))
      .data.id;
    await tool(agent, "delete_note", { note: id, expected_version: 1 });
    const answer = await tool(agent, "read_note", { note: id });
    expect(answer.data).toMatchObject({ error: "in_trash", path: "Lauf5/Solo" });
    expect(answer.data).not.toHaveProperty("batchRootId");
  });
});

describe("search", () => {
  it("marks a hyphenated word as one, and its parts elsewhere not at all", async () => {
    const body = "# Kasse\n\nDie App heißt app-kasse, daneben gibt es app-kalender.\n";
    await tool(agent, "create_note", { folder_id: base, title: "Kasse", body });
    const answer = await tool(agent, "search_notes", { query: "app-kasse", folder_id: base });
    const [hit] = answer.data.hits as { snippet: string }[];
    expect(hit?.snippet).toBe("Die App heißt «app-kasse», daneben gibt es app-kalender.");
    // Asked for as a word of its own, the part stays marked.
    const both = await tool(agent, "search_notes", { query: "app app-kasse", folder_id: base });
    const [again] = both.data.hits as { snippet: string }[];
    expect(again?.snippet).toContain("«app»-kalender");
    expect(again?.snippet).toContain("«app-kasse»");
  });
});

describe("read_revision", () => {
  it("names the note, over MCP and HTTP", async () => {
    const id = (await tool(agent, "create_note", { folder_id: base, title: "Rev", body: "v1" }))
      .data.id as string;
    const answer = await tool(agent, "read_revision", { note: id, version: 1 });
    expect(answer.data).toMatchObject({ noteId: id, version: 1, body: "v1" });
    const overHttp = await call(world.server, ada, "GET", `${notesApi}/notes/${id}/revisions/1`);
    expect(overHttp).toMatchObject({ status: 200, body: { revision: { noteId: id } } });
  });
});
