import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// The writing MCP tools through the SDK client: each once successfully and
// once refused, the version conflict, the token's name in the history, a
// token without edit, and revoking a token while the agent is connected.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let tokenId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "claude-code-laptop",
    permissions: ["read", "search", "create", "edit", "move"],
  });
  tokenId = token.id;
  agent = await connectMcp(world.server, token.token);
});

describe("creating", () => {
  it("create_folder and create_note, recorded with the token's name", async () => {
    const folder = await tool(agent, "create_folder", { name: "Agents" });
    expect(folder).toMatchObject({ isError: false, data: { name: "Agents", path: "Agents" } });
    const note = await tool(agent, "create_note", {
      folder_id: folder.data.id,
      title: "Plan",
      body: "# Goals\nShip it.\n\n# Risks\nNone yet.\n",
      reason: "kick-off",
    });
    expect(note.data).toMatchObject({ version: 1, changed: true });
    expect(await revisionRows(world.db, note.data.id as string)).toEqual([
      {
        version: 1,
        change: "created",
        reason: "kick-off",
        actor_name: "claude-code-laptop",
        actor_user_id: null,
        actor_token_id: tokenId,
      },
    ]);
    const [row] = await world.db.sql`select created_by_name from folders where name = 'Agents'`;
    expect(row?.created_by_name).toBe("claude-code-laptop");
    expect((await tool(agent, "create_folder", { name: "agents" })).data.error).toBe("name_taken");
    const twin = await tool(agent, "create_note", {
      folder_id: folder.data.id,
      title: "plan",
      body: "",
    });
    expect(twin).toMatchObject({ isError: true, data: { error: "title_taken" } });
  });
});

describe("changing", () => {
  it("update_note writes a new version and refuses a stale one", async () => {
    await tool(agent, "create_note", { title: "Draft", body: "v1" });
    const updated = await tool(agent, "update_note", {
      note: "Draft",
      expected_version: 1,
      body: "v2",
      reason: "more",
    });
    expect(updated.data).toMatchObject({ version: 2 });
    const stale = await tool(agent, "update_note", {
      note: "Draft",
      expected_version: 1,
      body: "x",
    });
    expect(stale).toMatchObject({
      isError: true,
      data: { error: "version_conflict", currentVersion: 2, updatedBy: "claude-code-laptop" },
    });
    const [row] = await world.db.sql`select body, version from notes where title = 'Draft'`;
    expect(row).toEqual({ body: "v2", version: 2 });
  });

  it("replace_section replaces one section and shows the current one on conflict", async () => {
    await tool(agent, "create_note", { title: "Sections", body: "# A\none\n\n# B\ntwo\n" });
    const replaced = await tool(agent, "replace_section", {
      note: "/Sections",
      expected_version: 1,
      section: "B",
      body: "# B\nthree\n",
    });
    expect(replaced.data).toMatchObject({ version: 2 });
    const stale = await tool(agent, "replace_section", {
      note: "Sections",
      expected_version: 1,
      section: "B",
      body: "# B\nfour\n",
    });
    expect(stale.data).toMatchObject({
      error: "version_conflict",
      currentSection: { path: "B", text: "# B\nthree\n" },
    });
    const [row] = await world.db.sql`select body from notes where title = 'Sections'`;
    expect(row?.body).toBe("# A\none\n\n# B\nthree\n");
  });

  it("move_note moves a note and refuses an unknown folder", async () => {
    const target = await tool(agent, "create_folder", { name: "Archive" });
    await tool(agent, "create_note", { title: "Mover", body: "" });
    const moved = await tool(agent, "move_note", {
      note: "Mover",
      expected_version: 1,
      folder_id: target.data.id,
    });
    expect(moved.data).toMatchObject({ version: 2 });
    const read = await tool(agent, "read_note", { note: "Archive/Mover" });
    expect(read.data.note).toMatchObject({ folderPath: "Archive" });
    const unknown = await tool(agent, "move_note", {
      note: "Archive/Mover",
      expected_version: 2,
      folder_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.data.error).toBe("folder_not_found");
  });
});

describe("limits", () => {
  it("refuses writes a token is not allowed to make", async () => {
    const reader = await apiToken(world, ada, { name: "read-only", permissions: ["read"] });
    const client = await connectMcp(world.server, reader.token);
    const refused = await tool(client, "create_note", { title: "Sneaky", body: "" });
    expect(refused).toMatchObject({
      isError: true,
      data: { error: "forbidden", permission: "create" },
    });
    const [count] = await world.db.sql`select count(*)::int as n from notes where title = 'Sneaky'`;
    expect(count?.n).toBe(0);
  });

  it("stops a connected agent as soon as its token is revoked", async () => {
    const token = await apiToken(world, ada, { name: "to-revoke", permissions: ["read"] });
    const client = await connectMcp(world.server, token.token);
    expect((await tool(client, "get_overview")).isError).toBe(false);
    await call(world.server, ada, "DELETE", `/api/tokens/v1/tokens/${token.id}`);
    await expect(client.callTool({ name: "get_overview", arguments: {} })).rejects.toThrow(
      /token_revoked/,
    );
  });
});
