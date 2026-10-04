import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// The MCP server through the official SDK client: connecting with an API
// token, the instructions and the guide, the tool list and the reading tools
// (each once successfully and once refused).

let world: NotesWorld;
let ada: Auth;
let client: Client;
let projects: string;
let noteId: string;

const TOOLS = [
  "create_folder",
  "create_note",
  "delete_folder",
  "delete_note",
  "get_overview",
  "hide_folder",
  "hide_note",
  "list_changes",
  "list_folder",
  "list_revisions",
  "list_trash",
  "lock_folder",
  "lock_note",
  "move_folder",
  "move_note",
  "read_note",
  "read_outline",
  "read_revision",
  "read_section",
  "rename_folder",
  "replace_section",
  "restore_folder",
  "restore_note",
  "search_notes",
  "update_note",
];

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  projects = await createFolder(world, ada, "Projects");
  noteId = await createNote(world, ada, {
    folderId: projects,
    title: "Conventions",
    body: "# Naming\nUse kebab-case for repositories.\n\n## Branches\nmain and dev.\n",
  });
  await createNote(world, ada, { title: "Conventions", body: "Root twin." });
  const token = await apiToken(world, ada, {
    name: "reader-agent",
    permissions: ["read", "search"],
  });
  client = await connectMcp(world.server, token.token);
});

describe("connecting", () => {
  it("sends instructions with the token's permissions and serves the guide", async () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain('"reader-agent"');
    expect(instructions).toContain("read, search");
    expect(instructions).toContain("expected_version");
    const guide = await client.readResource({ uri: "hexmark://guide" });
    const text = (guide.contents[0] as { text: string }).text;
    expect(text).toContain("Addressing a note");
    expect(text).toContain(
      "on the whole wiki as far as it can see it, including new content (read, search)",
    );
    // Search syntax, sizes with subsections, pieces, no-op writes, the trash with this
    // server's retention, locks.
    expect(text).toContain('"quoted phrases"');
    expect(text).toContain("so do its sizes");
    expect(text).toContain("offset: nextOffset");
    expect(text).toContain("its reason is dropped");
    expect(text).toContain(
      "You cannot\n  unlock: only people can, and people may still change locked items",
    );
    expect(text).toContain("answers locked with alreadyLocked: true");
    expect(text).toContain("for 28 days, then the server deletes them for good");
    expect(text).toContain("Agents cannot delete anything for good");
    expect(instructions).toContain("for 28 days, then the server deletes them for good");
  });

  it("lists all tools with JSON schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((entry) => entry.name).sort()).toEqual(TOOLS);
    const update = tools.find((entry) => entry.name === "update_note");
    expect(update?.inputSchema.required).toEqual(["note", "expected_version"]);
  });

  it("refuses a missing or unknown token with 401", async () => {
    const response = await fetch(`${world.server.url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer hmk_${"x".repeat(43)}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect((await fetch(`${world.server.url}/mcp`, { method: "GET" })).status).toBe(405);
  });
});

describe("reading tools", () => {
  it("get_overview shows access, tree and counts", async () => {
    const { isError, data } = await tool(client, "get_overview");
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      access: { kind: "token", actorName: "reader-agent", permissions: ["read", "search"] },
      counts: { notes: 2, folders: 1 },
    });
    expect(JSON.stringify(data.tree)).toContain("Conventions");
  });

  it("list_folder lists a folder and refuses an unknown one", async () => {
    const listed = await tool(client, "list_folder", { folder_id: projects });
    expect((listed.data.notes as { id: string }[]).map((note) => note.id)).toEqual([noteId]);
    const unknown = await tool(client, "list_folder", {
      folder_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown).toMatchObject({ isError: true, data: { error: "folder_not_found" } });
  });

  it("search_notes finds sections and refuses an empty query", async () => {
    const found = await tool(client, "search_notes", { query: "kebab" });
    expect(found.data.hits).toMatchObject([
      { noteId, folderPath: "Projects", sectionPath: "Naming", version: 1 },
    ]);
    const empty = await tool(client, "search_notes", { query: "" });
    expect(empty.isError).toBe(true);
  });

  it("read_outline addresses by path and reports ambiguous titles", async () => {
    const outline = await tool(client, "read_outline", { note: "Projects/Conventions" });
    expect((outline.data.sections as { path: string }[]).map((s) => s.path)).toEqual([
      "Naming",
      "Naming > Branches",
    ]);
    const ambiguous = await tool(client, "read_outline", { note: "conventions" });
    expect(ambiguous).toMatchObject({ isError: true, data: { error: "ambiguous_note" } });
    expect((ambiguous.data.candidates as { path: string }[]).map((c) => c.path)).toEqual([
      "Conventions",
      "Projects/Conventions",
    ]);
    expect(ambiguous.data.message).toEqual(expect.any(String));
  });

  it("read_section reads with and without subsections and refuses unknown sections", async () => {
    const whole = await tool(client, "read_section", { note: noteId, section: "Naming" });
    expect((whole.data.section as { text: string }).text).toContain("## Branches");
    const alone = await tool(client, "read_section", {
      note: noteId,
      section: "Naming",
      include_subsections: false,
    });
    expect((alone.data.section as { text: string }).text).not.toContain("Branches");
    const missing = await tool(client, "read_section", { note: noteId, section: "Nope" });
    expect(missing.data.error).toBe("section_not_found");
  });

  it("read_note reads the body and refuses an unknown note", async () => {
    const note = await tool(client, "read_note", { note: noteId });
    expect(note.data.note).toMatchObject({ id: noteId, version: 1, path: "Projects/Conventions" });
    const missing = await tool(client, "read_note", { note: "No such note" });
    expect(missing).toMatchObject({ isError: true, data: { error: "not_found" } });
  });

  it("list_changes, list_revisions and read_revision show the history", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const changes = await tool(client, "list_changes", { since });
    expect((changes.data.changes as unknown[]).length).toBe(2);
    expect((await tool(client, "list_changes", { since: "soon" })).isError).toBe(true);
    const revisions = await tool(client, "list_revisions", { note: noteId });
    expect(revisions.data.revisions).toMatchObject([{ version: 1, actorName: "ada" }]);
    const first = await tool(client, "read_revision", { note: noteId, version: 1 });
    expect(first.data).toMatchObject({ version: 1, change: "created", folderPath: "Projects" });
    const missing = await tool(client, "read_revision", { note: noteId, version: 9 });
    expect(missing.data.error).toBe("not_found");
    const revisionsHttp = await call(
      world.server,
      ada,
      "GET",
      `/api/notes/v1/notes/${noteId}/revisions`,
    );
    expect(revisionsHttp.body.revisions).toEqual(revisions.data.revisions);
  });
});
