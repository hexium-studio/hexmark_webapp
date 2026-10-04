import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  type NotesWorld,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";
import { tableCounts, trashRows, trashTree } from "./trash-harness";

// The trash tools through the SDK client: each once successfully and once
// refused, with the rows they write; in_trash for a note named by its id; a
// token without delete; and that an agent has no way to delete for good.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let tokenId: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "tidy-agent",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  tokenId = token.id;
  agent = await connectMcp(world.server, token.token);
});

describe("deleting", () => {
  it("delete_note moves a note to the trash by path, recorded with the token's name", async () => {
    const tree = await trashTree(world, ada, "M1");
    const deleted = await tool(agent, "delete_note", {
      note: "M1/Plan",
      expected_version: 1,
      reason: "superseded",
    });
    expect(deleted).toMatchObject({
      isError: false,
      data: { kind: "note", id: tree.plan, version: 2, path: "M1/Plan" },
    });
    expect((await trashRows(world.db, "notes", [tree.plan]))[0]).toMatchObject({
      inTrash: true,
      deletedByName: "tidy-agent",
      deletedByTokenId: tokenId,
      deletedByUserId: null,
    });
    expect((await revisionRows(world.db, tree.plan)).at(-1)).toMatchObject({
      change: "deleted",
      reason: "superseded",
      actor_name: "tidy-agent",
      actor_token_id: tokenId,
    });
    // By title or path it is gone; by id it is in the trash.
    expect((await tool(agent, "read_note", { note: "M1/Plan" })).data.error).toBe("not_found");
    const byId = await tool(agent, "read_note", { note: tree.plan });
    expect(byId).toMatchObject({
      isError: true,
      data: { error: "in_trash", deletedAt: deleted.data.deletedAt, purgeAt: deleted.data.purgeAt },
    });
    expect(byId.data.message).toContain("restore_note");
    const stale = await tool(agent, "delete_note", { note: tree.spec, expected_version: 9 });
    expect(stale.data).toMatchObject({ error: "version_conflict", currentVersion: 1 });
  });

  it("delete_folder takes the subtree along; restore_folder brings the batch back", async () => {
    const tree = await trashTree(world, ada, "M2");
    const deleted = await tool(agent, "delete_folder", { folder_id: tree.web, reason: "tidy" });
    expect(deleted.data).toMatchObject({
      kind: "folder",
      path: "M2/Web",
      folderCount: 1,
      noteCount: 2,
    });
    const batch = deleted.data.batchId;
    const rows = await trashRows(world.db, "notes", [tree.spec, tree.draft]);
    expect(rows.map((row) => [row.inTrash, row.batchId, row.version])).toEqual([
      [true, batch, 2],
      [true, batch, 2],
    ]);
    const unknown = await tool(agent, "delete_folder", {
      folder_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.data.error).toBe("folder_not_found");

    const restored = await tool(agent, "restore_folder", { folder_id: tree.web, reason: "oops" });
    expect(restored).toMatchObject({
      isError: false,
      data: { id: tree.web, path: "M2/Web", restoredSubfolders: 1, restoredNotes: 2 },
    });
    expect(
      (await trashRows(world.db, "notes", [tree.spec, tree.draft])).map((r) => r.version),
    ).toEqual([3, 3]);
    expect((await tool(agent, "restore_folder", { folder_id: tree.web })).data.error).toBe(
      "folder_not_deleted",
    );
  });
});

describe("listing and restoring", () => {
  it("list_trash names entries; restore_note needs folder_id while its folder is gone", async () => {
    const tree = await trashTree(world, ada, "M3");
    await tool(agent, "delete_folder", { folder_id: tree.web });
    const listed = await tool(agent, "list_trash", { folder_id: tree.projects });
    expect(listed.data).toMatchObject({
      retentionDays: 28,
      hasMore: false,
      entries: [
        { kind: "folder", id: tree.web, name: "Web", path: "M3/Web", deletedBy: "tidy-agent" },
      ],
    });

    const blocked = await tool(agent, "restore_note", { note_id: tree.spec });
    expect(blocked).toMatchObject({
      isError: true,
      data: { error: "parent_in_trash", folderId: tree.web, path: "M3/Web" },
    });
    expect(blocked.data.message).toContain("restore_folder");
    const moved = await tool(agent, "restore_note", {
      note_id: tree.spec,
      folder_id: tree.projects,
      reason: "needed now",
    });
    expect(moved.data).toMatchObject({ path: "M3/Spec", version: 3, changed: true });
    const root = await tool(agent, "restore_note", { note_id: tree.draft, folder_id: null });
    expect(root.data).toMatchObject({ path: "Draft", folderPath: "" });
    expect((await tool(agent, "restore_note", { note_id: tree.draft })).data.error).toBe(
      "note_not_deleted",
    );
  });
});

describe("what agents cannot do", () => {
  it("a token without delete is refused by every trash tool, and nothing changes", async () => {
    const tree = await trashTree(world, ada, "M4");
    const reader = await apiToken(world, ada, { name: "reader", permissions: ["read", "edit"] });
    const client = await connectMcp(world.server, reader.token);
    const before = await tableCounts(world.db);
    const calls: [string, Record<string, unknown>][] = [
      ["delete_note", { note: tree.plan, expected_version: 1 }],
      ["delete_folder", { folder_id: tree.web }],
      ["list_trash", {}],
      ["restore_note", { note_id: tree.plan }],
      ["restore_folder", { folder_id: tree.web }],
    ];
    for (const [name, args] of calls) {
      const answer = await tool(client, name, args);
      expect(answer, name).toMatchObject({
        isError: true,
        data: { error: "forbidden", permission: "delete" },
      });
    }
    expect(await tableCounts(world.db)).toEqual(before);
  });

  it("no tool deletes for good: what an agent deletes stays in the trash", async () => {
    const { tools } = await agent.listTools();
    const names = tools.map((entry) => entry.name);
    expect(names.filter((name) => /delete|purge|empty/.test(name)).sort()).toEqual([
      "delete_folder",
      "delete_note",
    ]);
    const tree = await trashTree(world, ada, "M5");
    await tool(agent, "delete_folder", { folder_id: tree.projects });
    const rows = await world.db.sql`
      select count(*)::int as n from notes
      where id in (${tree.spec}, ${tree.draft}, ${tree.plan}) and deleted_at is not null`;
    expect(rows[0]?.n).toBe(3);
  });
});
