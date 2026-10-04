import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// The section a replace_section changed, recorded in note_revisions.section_path
// (shortened at the front when longer than 1000 characters) and shown by
// list_revisions, read_revision, list_changes and the HTTP API, next to the
// folder path of each version.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let noteId: string;
let start: string;

const sectionRows = (id: string) =>
  world.db.sql`
    select version, change, section_path from note_revisions
    where note_id = ${id} order by version
  `;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "history-agent",
    permissions: ["read", "create", "edit", "move"],
  });
  agent = await connectMcp(world.server, token.token);
  start = new Date(Date.now() - 1000).toISOString();
  const created = await tool(agent, "create_note", {
    title: "Guide",
    body: "# Setup\n## Docker\nold\n# Usage\nuse it\n",
  });
  noteId = created.data.id as string;
});

describe("section paths in revisions", () => {
  it("records the full path for replace_section and null for whole-note changes", async () => {
    expect(await sectionRows(noteId)).toEqual([
      { version: 1, change: "created", section_path: null },
    ]);
    await tool(agent, "replace_section", {
      note: noteId,
      expected_version: 1,
      section: "docker",
      body: "## Docker\nnew\n",
      reason: "update docker",
    });
    await tool(agent, "update_note", { note: noteId, expected_version: 2, title: "Guide 2" });
    expect(await sectionRows(noteId)).toEqual([
      { version: 1, change: "created", section_path: null },
      { version: 2, change: "edited", section_path: "Setup > Docker" },
      { version: 3, change: "renamed", section_path: null },
    ]);
  });

  it("does not record a replace_section that changes nothing", async () => {
    const same = await tool(agent, "replace_section", {
      note: noteId,
      expected_version: 3,
      section: "Setup > Docker",
      body: "## Docker\nnew\n",
      reason: "no-op",
    });
    expect(same.data).toMatchObject({ changed: false, version: 3 });
    expect(await sectionRows(noteId)).toHaveLength(3);
  });

  it("shows sectionPath and folderPath in list_revisions, read_revision and the HTTP API", async () => {
    const listed = await tool(agent, "list_revisions", { note: noteId });
    expect(listed.data.revisions).toMatchObject([
      { version: 3, sectionPath: null, folderPath: "" },
      { version: 2, sectionPath: "Setup > Docker", folderPath: "", reason: "update docker" },
      { version: 1, sectionPath: null, folderPath: "" },
    ]);
    const second = await tool(agent, "read_revision", { note: noteId, version: 2 });
    expect(second.data).toMatchObject({ sectionPath: "Setup > Docker", folderPath: "" });
    const http = await call(world.server, ada, "GET", `${notesApi}/notes/${noteId}/revisions`);
    expect(http.body.revisions).toEqual(listed.data.revisions);
    const one = await call(world.server, ada, "GET", `${notesApi}/notes/${noteId}/revisions/2`);
    expect(one.body.revision).toEqual(second.data);
  });

  it("gives the folder path each version had, by the folder's current name", async () => {
    const folder = await createFolder(world, ada, "Docs");
    await tool(agent, "move_note", { note: noteId, expected_version: 3, folder_id: folder });
    const listed = await tool(agent, "list_revisions", { note: noteId });
    expect((listed.data.revisions as { folderPath: string }[]).map((r) => r.folderPath)).toEqual([
      "Docs",
      "",
      "",
      "",
    ]);
  });

  it("shows the latest change's section in list_changes", async () => {
    await tool(agent, "replace_section", {
      note: noteId,
      expected_version: 4,
      section: "Usage",
      body: "# Usage\nuse it well\n",
    });
    const changes = await tool(agent, "list_changes", { since: start });
    expect(changes.data.changes).toMatchObject([
      { noteId, change: "edited", changes: 5, sectionPath: "Usage", folderPath: "Docs" },
    ]);
  });

  it("keeps the end of a path above 1000 characters, behind '… > '", async () => {
    const top = "T".repeat(600);
    const sub = "S".repeat(600);
    const created = await tool(agent, "create_note", {
      title: "Deep",
      body: `# ${top}\n## ${sub}\ntext\n`,
    });
    const id = created.data.id as string;
    await tool(agent, "replace_section", {
      note: id,
      expected_version: 1,
      section: sub,
      body: `## ${sub}\nmore text\n`,
    });
    const [row] = await world.db.sql`
      select section_path, char_length(section_path)::int as length
      from note_revisions where note_id = ${id} and version = 2
    `;
    expect(row).toEqual({ section_path: `… > ${sub}`, length: 604 });
  });
});
