import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  createNote,
  type NotesWorld,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";
import { trashTree } from "./trash-harness";

// Answers the third agent test asked for: restore_note under another title
// (and the title_taken text that says so), where list_trash entries were
// (parentId, parentPath next to the item's id), the offset asked for past a
// section's end, and the section repeated with ambiguous_section.

let world: NotesWorld;
let ada: Auth;
let agent: Client;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "answers-agent",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  agent = await connectMcp(world.server, token.token);
});

const noteRow = async (id: string) =>
  (
    await world.db.sql`
      select title, folder_id, version, deleted_at is not null as in_trash
      from notes where id = ${id}`
  )[0];

describe("restore_note", () => {
  it("says how to go on when the title is taken, and restores under a new title", async () => {
    const tree = await trashTree(world, ada, "R1");
    await tool(agent, "delete_note", { note: tree.plan, expected_version: 1 });
    const holder = await tool(agent, "create_note", {
      folder_id: tree.projects,
      title: "Plan",
      body: "the new plan",
    });
    const taken = await tool(agent, "restore_note", { note_id: tree.plan });
    expect(taken).toMatchObject({
      isError: true,
      data: { error: "title_taken", existingNoteId: holder.data.id, path: "R1/Plan" },
    });
    const message = taken.data.message as string;
    expect(message).toContain("another title (title)");
    expect(message).toContain("folder_id");
    expect(message).not.toContain("change that note");
    // create_note keeps its own text for the same code.
    const clash = await tool(agent, "create_note", {
      folder_id: tree.projects,
      title: "plan",
      body: "",
    });
    expect(clash.data.message).toContain("choose another title");
    expect(await noteRow(tree.plan)).toEqual({
      title: "Plan",
      folder_id: tree.projects,
      version: 2,
      in_trash: true,
    });

    const restored = await tool(agent, "restore_note", {
      note_id: tree.plan,
      title: "Plan (2025)",
      reason: "keep the old plan next to the new one",
    });
    expect(restored.data).toMatchObject({ path: "R1/Plan (2025)", version: 3, changed: true });
    expect(await noteRow(tree.plan)).toEqual({
      title: "Plan (2025)",
      folder_id: tree.projects,
      version: 3,
      in_trash: false,
    });
    expect((await revisionRows(world.db, tree.plan)).at(-1)).toMatchObject({
      change: "restored",
      reason: "keep the old plan next to the new one",
      actor_name: "answers-agent",
    });
    const bad = await tool(agent, "restore_note", { note_id: tree.spec, title: "a/b" });
    expect(bad.data).toMatchObject({ error: "invalid_input", fields: { title: {} } });
  });
});

describe("list_trash", () => {
  it("names where each entry was as parentId and parentPath, beside its own id", async () => {
    const tree = await trashTree(world, ada, "L1");
    const atRoot = await createNote(world, ada, { title: "L1 loose", body: "" });
    await tool(agent, "delete_note", { note: atRoot, expected_version: 1 });
    await tool(agent, "delete_note", { note: tree.draft, expected_version: 1 });
    await tool(agent, "delete_folder", { folder_id: tree.web });
    const listed = await tool(agent, "list_trash", {});
    const entries = listed.data.entries as Record<string, unknown>[];
    const byId = (id: string) => entries.find((entry) => entry.id === id);
    expect(byId(tree.web)).toMatchObject({
      kind: "folder",
      parentId: tree.projects,
      parentPath: "L1",
    });
    expect(byId(tree.draft)).toMatchObject({
      kind: "note",
      parentId: tree.old,
      parentPath: "L1/Web/Old",
    });
    expect(byId(atRoot)).toMatchObject({ parentId: null, parentPath: "" });
    for (const entry of entries) expect(entry).not.toHaveProperty("folderId");
  });
});

describe("read_section", () => {
  it("repeats an offset past the end, and the section of an ambiguous path", async () => {
    const id = await createNote(world, ada, {
      title: "Sections A1",
      body: "# Top\n## Same\nabc\n## Same\nxyz\n",
    });
    const past = await tool(agent, "read_section", { note: id, section: "Top", offset: 999 });
    expect(past.data.section).toMatchObject({
      text: "",
      offset: 30,
      total: 30,
      requestedOffset: 999,
      hasMore: false,
    });
    const end = await tool(agent, "read_section", { note: id, section: "Top", offset: 30 });
    expect(end.data.section).not.toHaveProperty("requestedOffset");
    const twice = await tool(agent, "read_section", { note: id, section: "SAME" });
    expect(twice).toMatchObject({
      isError: true,
      data: {
        error: "ambiguous_section",
        section: "SAME",
        candidates: ["Top > Same", "Top > Same (2)"],
      },
    });
    const replace = await tool(agent, "replace_section", {
      note: id,
      expected_version: 1,
      section: "same",
      body: "## Same\n",
    });
    expect(replace.data).toMatchObject({ error: "ambiguous_section", section: "same" });
  });
});
