import { beforeAll, describe, expect, it } from "vitest";
import { eventsOf, oneEvent } from "./audit-log-harness";
import { type HiddenWorld, hiddenWorld, SECRET } from "./hidden-harness";
import { tool } from "./mcp-harness";
import { type Auth, call, notesApi, reauthenticated } from "./notes-api-harness";

// Hiding and unhiding in the audit log: every success and every refused
// attempt, with who, how (web, http, mcp), the reason and the hidden mark
// lifted; refused writes and reads of hidden items with error code hidden
// and the item named, never its content.

let h: HiddenWorld;
const api = (auth: Auth, method: "GET" | "POST" | "PATCH", path: string, body?: unknown) =>
  call(h.world.server, auth, method, `${notesApi}${path}`, body);

beforeAll(async () => {
  h = await hiddenWorld();
});

describe("successes", () => {
  it("logs hiding by a person and by an agent, with the reason", async () => {
    const { event: person } = await oneEvent(h.world.db, () =>
      api(h.ada, "POST", `/notes/${h.ids.plain}/hide`, { reason: "Draft" }),
    );
    expect(person).toMatchObject({
      action: "note.hidden",
      outcome: "success",
      actor_kind: "human",
      actor_name: "ada",
      source: "web",
      target_kind: "note",
      target_id: h.ids.plain,
      target_label: "Open/Plain",
      reason: "Draft",
      details: { changed: true },
    });
    const folder = await api(h.ada, "POST", "/folders", { name: "Cellar" });
    const { event: agent } = await oneEvent(h.world.db, () =>
      tool(h.mcp, "hide_folder", { folder_id: folder.body.id, reason: "Old stuff" }),
    );
    expect(agent).toMatchObject({
      action: "folder.hidden",
      outcome: "success",
      actor_kind: "agent",
      actor_name: "seeker",
      actor_token_id: h.agentId,
      source: "mcp",
      target_label: "Cellar",
      reason: "Old stuff",
    });
  });

  it("logs unhiding with the mark that was lifted", async () => {
    await reauthenticated(h.world.server, h.ada);
    const { event } = await oneEvent(h.world.db, () =>
      api(h.ada, "POST", `/notes/${h.ids.plain}/unhide`, {}),
    );
    expect(event).toMatchObject({
      action: "note.unhidden",
      outcome: "success",
      actor_name: "ada",
      details: {
        changed: true,
        hiddenBy: "ada",
        hideReason: "Draft",
        hiddenAt: expect.any(String),
      },
    });
  });
});

describe("failures", () => {
  it("logs an agent's attempt to unhide, to hide without a reason or without the permission", async () => {
    const { event: unhide } = await oneEvent(h.world.db, () =>
      api(h.agent, "POST", `/folders/${h.ids.vault}/unhide`, {}),
    );
    expect(unhide).toMatchObject({
      action: "folder.unhidden",
      outcome: "failure",
      error_code: "forbidden",
      source: "http",
      details: { refusal: { reason: "session_required" } },
    });
    const { event: noReason } = await oneEvent(h.world.db, () =>
      tool(h.mcp, "hide_note", { note: h.ids.plain }),
    );
    expect(noReason).toMatchObject({
      action: "note.hidden",
      outcome: "failure",
      error_code: "invalid_input",
    });
  });

  it("logs a person's unhide without a recent password", async () => {
    await h.world.db.sql`update sessions set reauthenticated_at = null`;
    const { event } = await oneEvent(h.world.db, () =>
      api(h.ada, "POST", `/notes/${h.ids.diary}/unhide`, {}),
    );
    expect(event).toMatchObject({
      action: "note.unhidden",
      outcome: "failure",
      error_code: "reauthentication_required",
      actor_name: "ada",
    });
  });

  it("logs refused writes and reads of hidden items, naming the item, not its content", async () => {
    const { events } = await eventsOf(h.world.db, async () => {
      await tool(h.mcp, "update_note", { note: h.ids.diary, expected_version: 2, title: "X" });
      await tool(h.mcp, "read_note", { note: h.ids.diary });
      await tool(h.mcp, "list_folder", { folder_id: h.ids.vault });
      await api(h.agent, "GET", "/hidden");
    });
    expect(events.map((event) => [event.action, event.outcome, event.error_code])).toEqual([
      ["note.updated", "failure", "hidden"],
      ["read.note", "failure", "hidden"],
      ["read.folder", "failure", "hidden"],
      ["read.hidden", "failure", "forbidden"],
    ]);
    expect(events[0]?.details).toMatchObject({
      refusal: { hiddenItem: { kind: "note", id: h.ids.diary, path: "Open/Diary" }, locked: null },
    });
    expect(events[2]?.details).toMatchObject({
      refusal: { hiddenItem: { kind: "folder", id: h.ids.vault, path: "Vault" } },
    });
    for (const event of events) expect(JSON.stringify(event)).not.toContain(SECRET);
  });
});
