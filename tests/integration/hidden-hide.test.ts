import { beforeAll, describe, expect, it } from "vitest";
import { type HiddenWorld, hiddenRow, hiddenWorld } from "./hidden-harness";
import { tool } from "./mcp-harness";
import { type Auth, call, notesApi, reauthenticated } from "./notes-api-harness";

// Hiding and unhiding: an agent with the hide permission hides with a
// reason (the row records the token), a second time changes nothing; only
// people unhide, with the password re-entered recently, and then the agent
// sees and changes it again. The list of hidden items is for people only.

let h: HiddenWorld;
const api = (auth: Auth, method: "GET" | "POST", path: string, body?: unknown) =>
  call(h.world.server, auth, method, `${notesApi}${path}`, body);

beforeAll(async () => {
  h = await hiddenWorld();
});

describe("hiding and unhiding", () => {
  it("lets an agent hide with a reason, once, and only people unhide", async () => {
    const note = await api(h.ada, "POST", "/notes", {
      folderId: h.ids.open,
      title: "Memo",
      body: "x",
    });
    const id = note.body.id as string;
    expect((await tool(h.mcp, "hide_note", { note: id })).data).toMatchObject({
      error: "invalid_input",
      fields: { reason: { code: "required" } },
    });
    expect(await hiddenRow(h.world, "notes", id)).toMatchObject({ hidden_at: null });
    const hidden = await tool(h.mcp, "hide_note", { note: "Open/Memo", reason: "Names inside" });
    expect(hidden.data).toMatchObject({
      kind: "note",
      id,
      path: "Open/Memo",
      changed: true,
      hidden: { by: "seeker", reason: "Names inside", inherited: false },
    });
    expect(await hiddenRow(h.world, "notes", id)).toMatchObject({
      hidden_by_name: "seeker",
      hidden_by_token_id: h.agentId,
      hidden_by_user_id: null,
      hide_reason: "Names inside",
    });
    const again = await tool(h.mcp, "hide_note", { note: id, reason: "Again" });
    expect(again.data).toMatchObject({ changed: false, hidden: { reason: "Names inside" } });
    expect(await api(h.agent, "POST", `/notes/${id}/unhide`, {})).toMatchObject({
      status: 403,
      body: { error: "forbidden", reason: "session_required" },
    });
    expect(await hiddenRow(h.world, "notes", id)).toMatchObject({ hide_reason: "Names inside" });
  });

  it("asks people for a recent password to unhide", async () => {
    await h.world.db.sql`update sessions set reauthenticated_at = null`;
    expect((await api(h.ada, "POST", `/folders/${h.ids.vault}/unhide`, {})).body).toMatchObject({
      error: "reauthentication_required",
    });
    expect(await hiddenRow(h.world, "folders", h.ids.vault)).toMatchObject({
      hidden_at: expect.any(Date),
    });
    await reauthenticated(h.world.server, h.ada);
    const done = await api(h.ada, "POST", `/folders/${h.ids.vault}/unhide`, {});
    expect(done.body).toMatchObject({ kind: "folder", changed: true, hidden: null });
    expect(await hiddenRow(h.world, "folders", h.ids.vault)).toEqual({
      hidden_at: null,
      hidden_by_name: null,
      hidden_by_user_id: null,
      hidden_by_token_id: null,
      hide_reason: null,
    });
    // Visible again: the agent can list it and change what is inside.
    const listed = await tool(h.mcp, "list_folder", { folder_id: h.ids.vault });
    expect(listed.isError).toBe(false);
    const renamed = await tool(h.mcp, "rename_folder", { folder_id: h.ids.inner, name: "Room" });
    expect(renamed.data).toMatchObject({ name: "Room", path: "Vault/Room" });
  });

  it("lists the hidden items for people only", async () => {
    const human = await api(h.ada, "GET", "/hidden");
    const items = human.body.items as { kind: string; path: string }[];
    expect(items.map((item) => `${item.kind}:${item.path}`)).toContain("note:Open/Diary");
    expect(await api(h.agent, "GET", "/hidden")).toMatchObject({
      status: 403,
      body: { reason: "session_required" },
    });
  });
});
