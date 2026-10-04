import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  createFolder,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";
import { tableCounts, trashTree } from "./trash-harness";

// rename_folder (edit) and move_folder (move) through the SDK client, with
// the folder rows before and after; the same services as the HTTP API, so
// the same name, cycle and folder scope rules. And folder_in_trash for a
// folder in the trash named by any folder tool.

let world: NotesWorld;
let ada: Auth;
let agent: Client;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "folder-agent",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  agent = await connectMcp(world.server, token.token);
});

const folderRow = async (id: string) =>
  (
    await world.db.sql`
      select parent_id, name, updated_by_name, updated_by_token_id is not null as by_token
      from folders where id = ${id}`
  )[0];

describe("rename_folder", () => {
  it("renames a folder, recorded with the token's name; refuses a taken name", async () => {
    const tree = await trashTree(world, ada, "F1");
    expect(await folderRow(tree.web)).toMatchObject({ name: "Web", updated_by_name: "ada" });
    const renamed = await tool(agent, "rename_folder", { folder_id: tree.web, name: "Site" });
    expect(renamed).toEqual({
      isError: false,
      data: {
        id: tree.web,
        name: "Site",
        parentId: tree.projects,
        parentOutsideScope: false,
        path: "F1/Site",
      },
    });
    expect(await folderRow(tree.web)).toEqual({
      parent_id: tree.projects,
      name: "Site",
      updated_by_name: "folder-agent",
      by_token: true,
    });
    // Paths below it follow; ids stay.
    expect((await tool(agent, "read_outline", { note: "F1/Site/Spec" })).data).toMatchObject({
      note: { id: tree.spec, path: "F1/Site/Spec" },
    });
    await createFolder(world, ada, "Docs", tree.projects);
    const taken = await tool(agent, "rename_folder", { folder_id: tree.web, name: "docs" });
    expect(taken).toMatchObject({ isError: true, data: { error: "name_taken" } });
    expect((await folderRow(tree.web))?.name).toBe("Site");
  });
});

describe("move_folder", () => {
  it("moves a folder with its contents, to the root level too; refuses a cycle", async () => {
    const tree = await trashTree(world, ada, "F2");
    const target = await createFolder(world, ada, "Target");
    const moved = await tool(agent, "move_folder", { folder_id: tree.web, parent_id: target });
    expect(moved.data).toMatchObject({ id: tree.web, parentId: target, path: "Target/Web" });
    expect(await folderRow(tree.web)).toMatchObject({
      parent_id: target,
      updated_by_name: "folder-agent",
    });
    const top = await tool(agent, "move_folder", { folder_id: tree.old, parent_id: null });
    expect(top.data).toMatchObject({ parentId: null, path: "Old" });
    expect((await folderRow(tree.old))?.parent_id).toBeNull();

    const cycle = await tool(agent, "move_folder", { folder_id: target, parent_id: tree.web });
    expect(cycle).toMatchObject({ isError: true, data: { error: "folder_cycle" } });
    expect((await folderRow(target))?.parent_id).toBeNull();
    const missing = await tool(agent, "move_folder", { folder_id: tree.web });
    expect(missing.data).toMatchObject({ error: "invalid_input", fields: { parent_id: {} } });
  });

  it("needs move, while rename needs edit", async () => {
    const tree = await trashTree(world, ada, "F3");
    const editor = await apiToken(world, ada, { name: "editor", permissions: ["read", "edit"] });
    const mover = await apiToken(world, ada, { name: "mover", permissions: ["read", "move"] });
    const asEditor = await connectMcp(world.server, editor.token);
    const asMover = await connectMcp(world.server, mover.token);
    expect(
      (await tool(asEditor, "rename_folder", { folder_id: tree.web, name: "E" })).isError,
    ).toBe(false);
    expect(
      (await tool(asEditor, "move_folder", { folder_id: tree.web, parent_id: null })).data,
    ).toMatchObject({ error: "forbidden", permission: "move" });
    expect(
      (await tool(asMover, "move_folder", { folder_id: tree.old, parent_id: tree.projects }))
        .isError,
    ).toBe(false);
    expect(
      (await tool(asMover, "rename_folder", { folder_id: tree.old, name: "M" })).data,
    ).toMatchObject({ error: "forbidden", permission: "edit" });
    expect(await folderRow(tree.web)).toMatchObject({ name: "E", parent_id: tree.projects });
    expect(await folderRow(tree.old)).toMatchObject({ name: "Old", parent_id: tree.projects });
  });

  it("keeps a token limited to folders inside them, without naming the parent", async () => {
    const tree = await trashTree(world, ada, "F4");
    const outside = await createFolder(world, ada, "Elsewhere");
    const scoped = await apiToken(world, ada, {
      name: "scoped",
      permissions: ["read", "edit", "move"],
      folderScope: [tree.projects],
    });
    const client = await connectMcp(world.server, scoped.token);
    const own = await tool(client, "rename_folder", { folder_id: tree.projects, name: "F4b" });
    expect(own.data).toEqual({
      id: tree.projects,
      name: "F4b",
      parentId: null,
      parentOutsideScope: true,
      path: "F4b",
    });
    const out = await tool(client, "move_folder", { folder_id: tree.old, parent_id: outside });
    expect(out.data).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    const toRoot = await tool(client, "move_folder", { folder_id: tree.old, parent_id: null });
    expect(toRoot.data).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    const foreign = await tool(client, "rename_folder", { folder_id: outside, name: "Mine" });
    expect(foreign.data).toMatchObject({ error: "folder_not_found" });
    expect(await folderRow(tree.old)).toMatchObject({ parent_id: tree.web, name: "Old" });
    expect(await folderRow(outside)).toMatchObject({ parent_id: null, name: "Elsewhere" });
  });
});

describe("a folder in the trash", () => {
  it("answers folder_in_trash to every folder tool, and nothing is written", async () => {
    const tree = await trashTree(world, ada, "F5");
    const deleted = await tool(agent, "delete_folder", { folder_id: tree.web, reason: "tidy" });
    const before = await tableCounts(world.db);
    const calls: [string, Record<string, unknown>][] = [
      ["list_folder", { folder_id: tree.web }],
      ["search_notes", { query: "spec", folder_id: tree.old }],
      ["create_note", { folder_id: tree.web, title: "N", body: "" }],
      ["move_note", { note: tree.plan, expected_version: 1, folder_id: tree.old }],
      ["create_folder", { parent_id: tree.web, name: "Sub" }],
      ["rename_folder", { folder_id: tree.web, name: "Webs" }],
      ["move_folder", { folder_id: tree.old, parent_id: null }],
      ["move_folder", { folder_id: tree.projects, parent_id: tree.web }],
      ["delete_folder", { folder_id: tree.web }],
    ];
    for (const [name, args] of calls) {
      const answer = await tool(agent, name, args);
      expect(answer, name).toMatchObject({
        isError: true,
        data: {
          error: "folder_in_trash",
          deletedAt: deleted.data.deletedAt,
          purgeAt: deleted.data.purgeAt,
          batchId: deleted.data.batchId,
        },
      });
      expect(answer.data.message, name).toContain("restore_folder");
    }
    expect(await tableCounts(world.db)).toEqual(before);
    expect(await folderRow(tree.web)).toMatchObject({ name: "Web", parent_id: tree.projects });
  });

  it("stays folder_not_found for a token that cannot see where it was", async () => {
    const tree = await trashTree(world, ada, "F6");
    const other = await createFolder(world, ada, "F6-other");
    const scoped = await apiToken(world, ada, {
      name: "narrow",
      permissions: ["read", "delete"],
      folderScope: [other],
    });
    await tool(agent, "delete_folder", { folder_id: tree.web });
    const client = await connectMcp(world.server, scoped.token);
    const answer = await tool(client, "list_folder", { folder_id: tree.web });
    expect(answer.data).toMatchObject({ error: "folder_not_found" });
    expect(answer.data).not.toHaveProperty("batchId");
  });
});
