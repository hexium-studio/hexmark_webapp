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
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// The lock tools over MCP (lock_note, lock_folder) and what a lock means for
// an agent's other tools: refused with locked, reads showing the lock.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let reader: Client;
const ALL = ["read", "search", "create", "edit", "move", "delete", "lock"];

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "mcp-locker",
    mode: "deny_list",
    basePermissions: ALL,
  });
  agent = await connectMcp(world.server, token.token);
  const plain = await apiToken(world, ada, {
    name: "mcp-reader",
    mode: "deny_list",
    basePermissions: ["read", "edit"],
  });
  reader = await connectMcp(world.server, plain.token);
});

describe("lock tools", () => {
  it("lock_note locks with a reason and keeps update_note away", async () => {
    const id = await createNote(world, ada, {
      folderId: null,
      title: "Spec",
      body: "# Spec\n\nx\n",
    });
    const missing = await tool(agent, "lock_note", { note: id });
    expect(missing.data).toMatchObject({
      error: "invalid_input",
      fields: { reason: { code: "required" } },
    });
    expect((await tool(reader, "lock_note", { note: id, reason: "r" })).data).toMatchObject({
      error: "forbidden",
      permission: "lock",
    });
    const locked = await tool(agent, "lock_note", { note: "Spec", reason: "Signed off" });
    expect(locked).toMatchObject({
      isError: false,
      data: { kind: "note", id, changed: true, locked: { by: "mcp-locker", reason: "Signed off" } },
    });
    const refused = await tool(agent, "update_note", { note: id, expected_version: 1, body: "y" });
    expect(refused).toMatchObject({
      isError: true,
      data: {
        error: "locked",
        lockedItem: { kind: "note", id, path: "Spec" },
        lockedBy: "mcp-locker",
        reason: "Signed off",
      },
    });
    expect(refused.data.message).toContain("Only a person can unlock");
    const read = await tool(reader, "read_note", { note: id });
    expect(read.data).toMatchObject({
      note: { version: 1, locked: { reason: "Signed off", inherited: false } },
    });
    const [row] = await world.db.sql`select version, body, lock_reason from notes where id = ${id}`;
    expect(row).toEqual({ version: 1, body: "# Spec\n\nx\n", lock_reason: "Signed off" });
  });

  it("lock_folder covers later notes; list_folder and read_outline show it", async () => {
    const folder = await createFolder(world, ada, "Frozen");
    expect(
      (await tool(agent, "lock_folder", { folder_id: folder, reason: "Frozen" })).isError,
    ).toBe(false);
    const later = await createNote(world, ada, { folderId: folder, title: "Later", body: "# L\n" });
    const listed = await tool(agent, "list_folder", { folder_id: folder });
    expect(listed.data).toMatchObject({
      folder: { locked: { inherited: false } },
      notes: [{ id: later, locked: { inherited: true, from: { kind: "folder", id: folder } } }],
    });
    const outline = await tool(agent, "read_outline", { note: later });
    expect(outline.data).toMatchObject({ note: { locked: { inherited: true } } });
    for (const [name, args] of [
      ["create_note", { folder_id: folder, title: "No", body: "x" }],
      ["create_folder", { parent_id: folder, name: "No" }],
      ["delete_note", { note: later, expected_version: 1 }],
      ["rename_folder", { folder_id: folder, name: "Thawed" }],
      ["delete_folder", { folder_id: folder }],
      ["lock_note", { note: later, reason: "inside" }],
    ] as const) {
      const answer = await tool(agent, name, args);
      expect(answer.data, name).toMatchObject({ error: "locked", lockedItem: { id: folder } });
    }
    const [count] = await world.db.sql`
      select count(*)::int as n from notes where folder_id = ${folder} and deleted_at is null`;
    expect(count?.n).toBe(1);
  });

  it("restore_folder cannot bring back a locked note a person deleted with its folder", async () => {
    const folder = await createFolder(world, ada, "Bin");
    const note = await createNote(world, ada, { folderId: folder, title: "Pinned", body: "x" });
    await call(world.server, ada, "POST", `${notesApi}/notes/${note}/lock`, {});
    await call(world.server, ada, "DELETE", `${notesApi}/folders/${folder}`, {});
    const refused = await tool(agent, "restore_folder", { folder_id: folder });
    expect(refused.data).toMatchObject({ error: "locked", lockedItem: { kind: "note", id: note } });
    const [row] = await world.db.sql`select deleted_at from folders where id = ${folder}`;
    expect(row?.deleted_at).toBeInstanceOf(Date);
    // A person may.
    const restored = await call(world.server, ada, "POST", `${notesApi}/folders/${folder}/restore`);
    expect(restored.status).toBe(200);
  });
});
