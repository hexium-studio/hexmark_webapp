import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { eventsOf, oneEvent } from "./audit-log-harness";
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

// What the fifth agent test asked for about folders, over MCP and the HTTP
// API: create_folder takes a reason, kept in the audit log like those of
// rename_folder and move_folder, and folder_cycle names the folder and the
// target parent inside it, with their paths, writing nothing.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let base: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "run-5",
    permissions: ["read", "create", "edit", "move"],
  });
  agent = await connectMcp(world.server, token.token);
  base = (await tool(agent, "create_folder", { name: "Lauf5" })).data.id as string;
});

const folder = async (name: string, parent = base) =>
  (await tool(agent, "create_folder", { parent_id: parent, name })).data.id as string;

const folderRow = async (id: string) =>
  (await world.db.sql`select name, parent_id, deleted_at from folders where id = ${id}`)[0];

describe("create_folder", () => {
  it("records the reason in the audit log, over MCP and HTTP", async () => {
    const overMcp = await oneEvent(world.db, () =>
      tool(agent, "create_folder", { parent_id: base, name: "Mit Grund", reason: "Ordnung" }),
    );
    expect(overMcp.event).toMatchObject({
      action: "folder.created",
      source: "mcp",
      target_label: "Lauf5/Mit Grund",
      reason: "Ordnung",
    });
    const overHttp = await oneEvent(world.db, () =>
      call(world.server, ada, "POST", `${notesApi}/folders`, {
        name: "Per HTTP",
        parentId: base,
        reason: "Auch hier",
      }),
    );
    expect(overHttp.result).toMatchObject({ status: 201 });
    expect(overHttp.event).toMatchObject({ source: "web", reason: "Auch hier" });
    const without = await oneEvent(world.db, () => folder("Ohne Grund"));
    expect(without.event).toMatchObject({ action: "folder.created", reason: null });
  });
});

describe("folder_cycle", () => {
  it("names the folder and the target inside it, writing nothing", async () => {
    const outer = await folder("Aussen");
    const middle = await folder("Mitte", outer);
    const deep = await folder("Tief", middle);
    const before = await folderRow(outer);
    const { result, events } = await eventsOf(world.db, () =>
      tool(agent, "move_folder", { folder_id: outer, parent_id: deep, reason: "Kreis" }),
    );
    const cycle = {
      error: "folder_cycle",
      folderId: outer,
      path: "Lauf5/Aussen",
      parentId: deep,
      parentPath: "Lauf5/Aussen/Mitte/Tief",
    };
    expect(result).toMatchObject({ isError: true, data: cycle });
    expect(events).toEqual([
      expect.objectContaining({
        outcome: "failure",
        error_code: "folder_cycle",
        details: expect.objectContaining({
          refusal: {
            folderId: outer,
            path: "Lauf5/Aussen",
            parentId: deep,
            parentPath: "Lauf5/Aussen/Mitte/Tief",
          },
        }),
      }),
    ]);
    const self = await call(world.server, ada, "POST", `${notesApi}/folders/${outer}/move`, {
      parentId: outer,
    });
    expect(self).toEqual({
      status: 409,
      body: { ...cycle, parentId: outer, parentPath: "Lauf5/Aussen" },
    });
    expect(await folderRow(outer)).toEqual(before);
  });
});
