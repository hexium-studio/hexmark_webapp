import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, type ToolAnswer, tool } from "./mcp-harness";
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

// What answers name about folders and notes out of a token's reach: their
// names may show in paths, their ids never (folderId, existingFolderId,
// existingNoteId null), over MCP and HTTP - while ids the token can reach
// stay in the answers. And the root level of an allow list: outside_scope for
// creating, moving and restoring there, also for a token holding create
// nowhere; a reachable folder without the permission still names it.

const WORD = "pangolinword";
const body = (title: string) => `# ${title}\n\nThe ${WORD} is here.\n\n## More\n\nText.\n`;

let world: NotesWorld;
let ada: Auth;
const ids = {} as Record<
  "offen" | "lonely" | "work" | "inWork" | "sub" | "gone" | "box" | "excluded" | "twin",
  string
>;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  ids.offen = await createFolder(world, ada, "Offen");
  const note = (folderId: string, title: string, text = body(title)) =>
    createNote(world, ada, { folderId, title, body: text });
  ids.lonely = await note(ids.offen, "Lonely");
  ids.work = await createFolder(world, ada, "Work");
  ids.sub = await createFolder(world, ada, "Sub", ids.work);
  ids.inWork = await note(ids.work, "Plan");
  ids.gone = await note(ids.work, "Gone", "x");
  ids.box = await createFolder(world, ada, "Box");
  ids.excluded = await createFolder(world, ada, "Taken", ids.box);
  ids.twin = await note(ids.box, "Twin", "x");
});

async function allowToken(name: string, entries: unknown[]) {
  const created = await apiToken(world, ada, { name, mode: "allow_list", entries });
  return { auth: created.auth, mcp: await connectMcp(world.server, created.token) };
}

const counts = async () =>
  (
    await world.db.sql`
    select (select count(*)::int from notes) as notes, (select count(*)::int from folders) as folders,
      (select count(*)::int from notes where folder_id is null) as root_notes
  `
  )[0];

describe("ids of folders out of reach", () => {
  it("are null in every answer about a single listed note; reachable ones stay", async () => {
    const { auth, mcp } = await allowToken("single", [
      { kind: "note", id: ids.lonely, permissions: ["read", "edit", "lock"] },
      { kind: "folder", id: ids.work, permissions: ["read", "search"] },
    ]);
    const note = await tool(mcp, "read_note", { note: ids.lonely });
    expect(note.data.note).toMatchObject({
      folderId: null,
      folderPath: "Offen",
      path: "Offen/Lonely",
    });
    const outline = await tool(mcp, "read_outline", { note: ids.lonely });
    expect(outline.data.note).toMatchObject({ folderId: null, folderPath: "Offen" });
    const section = await tool(mcp, "read_section", { note: ids.lonely, section: "More" });
    expect(section.data.note).toMatchObject({ folderId: null });
    const search = await tool(mcp, "search_notes", { query: WORD });
    const hits = search.data.hits as { noteId: string; folderId: string | null }[];
    expect(hits.map((hit) => [hit.noteId, hit.folderId]).sort()).toEqual(
      [
        [ids.lonely, null],
        [ids.inWork, ids.work],
      ].sort(),
    );
    // The case that must go on naming its folder.
    expect((await tool(mcp, "read_note", { note: ids.inWork })).data.note).toMatchObject({
      folderId: ids.work,
    });
    const http = await call(world.server, auth, "GET", `${notesApi}/notes/${ids.lonely}`);
    expect(http.body.note).toMatchObject({ folderId: null, folderPath: "Offen" });
    const answers: ToolAnswer[] = [note, outline, section, search];
    answers.push(await tool(mcp, "get_overview"));
    answers.push(await tool(mcp, "list_folder"));
    answers.push(await tool(mcp, "list_changes", { since: "2000-01-01T00:00:00Z" }));
    answers.push(await tool(mcp, "list_revisions", { note: ids.lonely }));
    answers.push(await tool(mcp, "read_revision", { note: ids.lonely, version: 1 }));
    answers.push(
      await tool(mcp, "update_note", {
        note: ids.lonely,
        expected_version: 1,
        body: body("Lonely 2"),
        reason: "Edit",
      }),
    );
    answers.push(await tool(mcp, "lock_note", { note: ids.lonely, reason: "Keep" }));
    answers.push(
      await tool(mcp, "update_note", { note: ids.lonely, expected_version: 2, body: "y" }),
    );
    expect(answers.filter((answer) => !answer.isError)).toHaveLength(11);
    expect(answers[11]?.data).toMatchObject({ error: "locked", lockedItem: { kind: "note" } });
    // The scan measured something: 13 answers, most naming the folder by name.
    const texts = [...answers, http].map((answer) => JSON.stringify(answer));
    expect(texts).toHaveLength(13);
    for (const text of texts) expect(text).not.toContain(ids.offen);
    expect(texts.filter((text) => text.includes("Offen")).length).toBeGreaterThanOrEqual(9);
  });

  it("are null in name_taken and title_taken for an excluded holder of a deny list", async () => {
    const created = await apiToken(world, ada, {
      name: "except",
      mode: "deny_list",
      basePermissions: ["read", "create", "edit"],
      entries: [
        { kind: "folder", id: ids.excluded },
        { kind: "note", id: ids.twin },
      ],
    });
    const mcp = await connectMcp(world.server, created.token);
    const before = await counts();
    const folder = await tool(mcp, "create_folder", { parent_id: ids.box, name: "taken" });
    expect(folder.data).toMatchObject({
      error: "name_taken",
      existingFolderId: null,
      path: "Box/Taken",
    });
    const note = await tool(mcp, "create_note", { folder_id: ids.box, title: "twin", body: "x" });
    expect(note.data).toMatchObject({
      error: "title_taken",
      existingNoteId: null,
      path: "Box/Twin",
    });
    // Holders it can reach are still named.
    const seen = await tool(mcp, "create_note", { folder_id: ids.work, title: "plan", body: "x" });
    expect(seen.data).toMatchObject({ error: "title_taken", existingNoteId: ids.inWork });
    const sibling = await tool(mcp, "create_folder", { parent_id: ids.work, name: "SUB" });
    expect(sibling.data).toMatchObject({ error: "name_taken", existingFolderId: ids.sub });
    expect(await counts()).toEqual(before);
  });
});

describe("the root level of an allow list", () => {
  it("is outside_scope for creating, even for a token holding create nowhere", async () => {
    const { auth, mcp } = await allowToken("note-only", [
      { kind: "note", id: ids.lonely, permissions: ["read"] },
    ]);
    const before = await counts();
    for (const [name, args] of [
      ["create_note", { title: "New", body: "x" }],
      ["create_folder", { name: "New" }],
      ["create_folder", { parent_id: ids.offen, name: "New" }],
    ] as const) {
      const answer = await tool(mcp, name, args);
      expect(answer.data, name).toMatchObject({ error: "forbidden", reason: "outside_scope" });
      expect(answer.data.permission, name).toBeUndefined();
    }
    const http = await call(world.server, auth, "POST", `${notesApi}/notes`, {
      title: "N",
      body: "x",
    });
    expect(http).toMatchObject({
      status: 403,
      body: { error: "forbidden", reason: "outside_scope" },
    });
    expect(await counts()).toEqual(before);
  });

  it("is outside_scope for moving and restoring there; a reachable folder names the permission", async () => {
    const { mcp } = await allowToken("worker", [
      { kind: "folder", id: ids.work, permissions: ["read", "move", "delete"] },
    ]);
    const before = await counts();
    const noCreate = await tool(mcp, "create_note", { folder_id: ids.work, title: "N", body: "x" });
    expect(noCreate.data).toMatchObject({ error: "forbidden", permission: "create" });
    const moved = await tool(mcp, "move_note", {
      note: ids.inWork,
      expected_version: 1,
      folder_id: null,
    });
    expect(moved.data).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    const folder = await tool(mcp, "move_folder", { folder_id: ids.sub, parent_id: null });
    expect(folder.data).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    expect((await tool(mcp, "delete_note", { note: ids.gone, expected_version: 1 })).isError).toBe(
      false,
    );
    const restored = await tool(mcp, "restore_note", { note_id: ids.gone, folder_id: null });
    expect(restored.data).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    // Back where it was works.
    expect((await tool(mcp, "restore_note", { note_id: ids.gone })).isError).toBe(false);
    expect(await counts()).toEqual(before);
    const [sub] = await world.db.sql`select parent_id from folders where id = ${ids.sub}`;
    expect(sub).toEqual({ parent_id: ids.work });
    const [gone] = await world.db
      .sql`select folder_id, deleted_at from notes where id = ${ids.gone}`;
    expect(gone).toEqual({ folder_id: ids.work, deleted_at: null });
  });
});
