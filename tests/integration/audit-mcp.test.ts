import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { PASSWORD } from "./auth-harness";
import { connectMcp, tool } from "./mcp-harness";
import { type Auth, apiToken, type NotesWorld, notesWorld, signedIn } from "./notes-api-harness";

// The audit log for MCP tool calls: every read and write is one event with
// source mcp and the token's name; every refused call (invalid arguments,
// a missing permission, a missing note) is a failure with the tool's action,
// its error code and the arguments summarized - never a body.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let token: { id: string; token: string };
let folderId: string;
let noteId: string;

const BODY = "mcp-marker-3c8e intro\n\n# One\nmcp-step-0f7b\n";

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  token = await apiToken(world, ada, {
    name: "mcp-agent",
    permissions: ["read", "search", "create", "edit", "delete"],
  });
  agent = await connectMcp(world.server, token.token);
  folderId = (await tool(agent, "create_folder", { name: "Base" })).data.id as string;
  const created = await tool(agent, "create_note", {
    folder_id: folderId,
    title: "Doc",
    body: BODY,
  });
  noteId = created.data.id as string;
});

afterAll(async () => {
  const secrets = [PASSWORD, token.token, "mcp-marker-3c8e", "mcp-step-0f7b", "mcp-new-9d1a"];
  expect(await expectNoSecrets(world.db, secrets)).toBeGreaterThan(20);
});

const byAgent = () => ({
  actor_kind: "agent",
  actor_token_id: token.id,
  actor_name: "mcp-agent",
  source: "mcp",
});

describe("read tools", () => {
  it("log one event per call with source mcp", async () => {
    const calls: [string, Record<string, unknown>, string][] = [
      ["get_overview", {}, "read.overview"],
      ["list_folder", { folder_id: folderId }, "read.folder"],
      ["search_notes", { query: "doc" }, "read.search"],
      ["read_outline", { note: "Base/Doc" }, "read.outline"],
      ["read_section", { note: noteId, section: "One", offset: 0, limit: 10 }, "read.section"],
      ["read_note", { note: noteId }, "read.note"],
      ["list_changes", { since: "2020-01-01T00:00:00Z" }, "read.changes"],
      ["list_revisions", { note: noteId }, "read.revisions"],
      ["read_revision", { note: noteId, version: 1 }, "read.revision"],
      ["list_trash", {}, "read.trash"],
    ];
    for (const [name, args, action] of calls) {
      const { result, event } = await oneEvent(world.db, () => tool(agent, name, args));
      expect((result as { isError: boolean }).isError, name).toBe(false);
      expect(event, name).toMatchObject({ ...byAgent(), action, outcome: "success" });
    }
  });
});

describe("write tools", () => {
  it("log one event per change, with the reason, a folder's reason as well", async () => {
    const update = await oneEvent(world.db, () =>
      tool(agent, "update_note", {
        note: noteId,
        expected_version: 1,
        body: "mcp-new-9d1a",
        reason: "rewrite",
      }),
    );
    expect(update.event).toMatchObject({
      ...byAgent(),
      action: "note.updated",
      target_id: noteId,
      target_label: "Base/Doc",
      reason: "rewrite",
      details: { version: 2, bodyCharacters: 12 },
    });
    const rename = await oneEvent(world.db, () =>
      tool(agent, "rename_folder", { folder_id: folderId, name: "Basis", reason: "German" }),
    );
    expect(rename.event).toMatchObject({
      ...byAgent(),
      action: "folder.renamed",
      reason: "German",
      details: { previousName: "Base", name: "Basis" },
    });
  });
});

describe("refused calls", () => {
  it("log invalid arguments as a failure of the tool's action", async () => {
    const { result, event } = await oneEvent(world.db, () =>
      tool(agent, "replace_section", { note: noteId, expected_version: "two", section: "One" }),
    );
    expect(result).toMatchObject({ isError: true, data: { error: "invalid_input" } });
    expect(event).toMatchObject({
      ...byAgent(),
      action: "note.section_replaced",
      outcome: "failure",
      error_code: "invalid_input",
      details: {
        input: { note: noteId, expected_version: "two", section: "One" },
        refusal: {
          fields: [
            { field: "body", error: "required" },
            { field: "expected_version", error: "invalid_type" },
          ],
        },
      },
    });
  });

  it("log refusals of the services with their code and the arguments", async () => {
    const forbidden = await oneEvent(world.db, () =>
      tool(agent, "move_note", { note: noteId, expected_version: 2, folder_id: null }),
    );
    expect(forbidden.event).toMatchObject({
      action: "note.moved",
      error_code: "forbidden",
      details: {
        input: { note: noteId, expectedVersion: 2, folderId: null },
        refusal: { permission: "move" },
      },
    });
    const missing = await oneEvent(world.db, () => tool(agent, "read_note", { note: "Nowhere" }));
    expect(missing.event).toMatchObject({
      action: "read.note",
      error_code: "not_found",
      details: { input: { note: "Nowhere" } },
    });
  });

  it("log a note in the trash as in_trash, with its batch and where it was", async () => {
    const trashed = await tool(agent, "delete_note", { note: noteId, expected_version: 2 });
    const { result, event } = await oneEvent(world.db, () =>
      tool(agent, "read_outline", { note: noteId }),
    );
    expect(result).toMatchObject({
      isError: true,
      data: { error: "in_trash", batchId: trashed.data.batchId, path: "Basis/Doc" },
    });
    expect(event).toMatchObject({
      error_code: "in_trash",
      details: { refusal: { batchId: trashed.data.batchId, path: "Basis/Doc" } },
    });
  });
});

describe("tokens that do not work", () => {
  it("are logged as auth.token_rejected: a revoked one by name, an unknown one not at all", async () => {
    const doomed = await apiToken(world, ada, { name: "doomed", permissions: ["read"] });
    const client = await connectMcp(world.server, doomed.token);
    await world.db.sql`update api_tokens set revoked_at = now() where id = ${doomed.id}`;
    const revoked = await oneEvent(world.db, () => tool(client, "get_overview").catch(() => null));
    expect(revoked.event).toMatchObject({
      actor_kind: "agent",
      actor_token_id: doomed.id,
      actor_name: "doomed",
      source: "mcp",
      action: "auth.token_rejected",
      outcome: "failure",
      error_code: "token_revoked",
      target_kind: "token",
      target_id: doomed.id,
    });
    const unknown = `hmk_${"A".repeat(43)}`;
    const { events } = await eventsOf(world.db, () =>
      fetch(`${world.server.url}/api/notes/v1/tree`, {
        headers: { authorization: `Bearer ${unknown}` },
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        actor_kind: "agent",
        actor_user_id: null,
        actor_token_id: null,
        actor_name: "invalid token",
        source: "http",
        action: "auth.token_rejected",
        error_code: "unauthenticated",
        target_kind: null,
        details: {},
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(unknown.slice(4, 20));
  });
});
