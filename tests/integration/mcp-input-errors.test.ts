import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import { apiToken, type NotesWorld, notesWorld, signedIn } from "./notes-api-harness";

// Invalid arguments over a real MCP connection: every tool answers a Hexmark
// tool error invalid_input with code and rule per field (not the SDK's
// JSON-RPC -32602 text), and nothing is written. Valid calls still pass.

let world: NotesWorld;
let agent: Client;
let folderId: string;

type Fields = Record<string, { code: string; rule: string; params?: Record<string, number> }>;

async function counts() {
  const [row] = await world.db.sql`
    select (select count(*)::int from notes) as notes,
      (select count(*)::int from folders) as folders,
      (select count(*)::int from note_revisions) as revisions
  `;
  return row;
}

async function invalid(name: string, args: Record<string, unknown>): Promise<Fields> {
  const answer = await tool(agent, name, args);
  expect(answer.isError, name).toBe(true);
  expect(answer.data.error, `${name}: ${JSON.stringify(answer.data)}`).toBe("invalid_input");
  expect(answer.data.message).toEqual(expect.any(String));
  return answer.data.fields as Fields;
}

beforeAll(async () => {
  world = await notesWorld();
  const { auth } = await signedIn(world, "ada");
  const token = await apiToken(world, auth, {
    name: "careless-agent",
    permissions: ["read", "search", "create", "edit", "move"],
  });
  agent = await connectMcp(world.server, token.token);
  folderId = (await tool(agent, "create_folder", { name: "Box" })).data.id as string;
  await tool(agent, "create_note", { folder_id: folderId, title: "Plan", body: "# A\na\n" });
});

describe("invalid arguments", () => {
  it("create_note: '/' in the title, an empty and a blank title, a missing one", async () => {
    const before = await counts();
    expect(before).toEqual({ notes: 1, folders: 1, revisions: 1 });
    expect((await invalid("create_note", { title: "a/b", body: "" })).title).toEqual({
      code: "invalid_format",
      rule: "title must not contain '/' or control characters such as line breaks and tabs",
    });
    for (const title of ["", "   "]) {
      expect((await invalid("create_note", { title, body: "" })).title).toEqual({
        code: "empty",
        rule: "title must not be empty",
      });
    }
    expect((await invalid("create_note", { body: "" })).title).toEqual({
      code: "required",
      rule: "title is required",
    });
    expect(await counts()).toEqual(before);
  });

  it("update_note, replace_section and move_note: versions, ids and empty paths", async () => {
    const before = await counts();
    const update = await invalid("update_note", { note: " ", expected_version: 1.5, body: "x" });
    expect(update).toEqual({
      note: { code: "empty", rule: "note must not be empty" },
      expected_version: { code: "invalid_type", rule: "expected_version must be a whole number" },
    });
    const replace = await invalid("replace_section", {
      note: "Box/Plan",
      expected_version: 0,
      section: "",
      body: "x",
    });
    expect(replace).toEqual({
      expected_version: { code: "invalid", rule: "expected_version must be at least 1" },
      section: { code: "empty", rule: "section must not be empty" },
    });
    const move = await invalid("move_note", { note: "Box/Plan", expected_version: 1 });
    expect(move.folder_id).toEqual({ code: "required", rule: "folder_id is required" });
    const badFolder = await invalid("move_note", {
      note: "Box/Plan",
      expected_version: 1,
      folder_id: "not-a-uuid",
    });
    expect(badFolder.folder_id?.rule).toBe("folder_id must be a UUID or null");
    expect(await counts()).toEqual(before);
    const [row] = await world.db.sql`select version, body from notes where title = 'Plan'`;
    expect(row).toEqual({ version: 1, body: "# A\na\n" });
  });

  it("reading tools: limits, offsets, times and queries", async () => {
    expect(await invalid("list_folder", { depth: 0 })).toEqual({
      depth: { code: "invalid", rule: "depth must be at least 1" },
    });
    expect(await invalid("search_notes", { query: "  ", limit: 51 })).toEqual({
      query: { code: "empty", rule: "query must not be empty" },
      limit: { code: "too_long", params: { max: 50 }, rule: "limit must be at most 50" },
    });
    expect((await invalid("list_changes", { since: "yesterday" })).since?.code).toBe(
      "invalid_format",
    );
    expect(
      await invalid("read_section", { note: "Box/Plan", section: "A", offset: -1, limit: 0 }),
    ).toEqual({
      offset: { code: "invalid", rule: "offset must be at least 0" },
      limit: { code: "invalid", rule: "limit must be at least 1" },
    });
    expect(await invalid("read_revision", { note: "Box/Plan", version: "1" })).toEqual({
      version: { code: "invalid_type", rule: "version must be a whole number" },
    });
    expect((await invalid("create_folder", { name: "x/y" })).name?.code).toBe("invalid_format");
  });

  it("still lets valid calls through", async () => {
    const read = await tool(agent, "read_section", { note: "Box/Plan", section: "a" });
    expect(read).toMatchObject({ isError: false, data: { section: { path: "A" } } });
    const created = await tool(agent, "create_note", { title: "  Trimmed  ", body: "" });
    expect(created).toMatchObject({ isError: false, data: { path: "Trimmed", version: 1 } });
    expect(await counts()).toMatchObject({ notes: 2 });
  });

  it("answers an unknown tool with a JSON-RPC error, as the SDK does", async () => {
    // Also the tools an agent might look for to delete for good: there are none.
    for (const name of ["lock_note", "purge_note", "empty_trash", "delete_note_permanently"]) {
      await expect(agent.callTool({ name, arguments: {} })).rejects.toMatchObject({
        code: -32602,
      });
    }
  });
});
