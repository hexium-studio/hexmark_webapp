import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import { apiToken, type NotesWorld, notesWorld, signedIn } from "./notes-api-harness";

// What the tools tell an agent beyond the bare result: repeated headings and
// path ends, long sections in pieces, paths after writes, who holds a title,
// what a conflicting version changed, folder counts and cut-off snippets.

let world: NotesWorld;
let agent: Client;
let box: string;

const NAMING = [
  "# Naming",
  "## Parts",
  "### Apps",
  "Apps get a prefix.",
  "## Examples",
  "first",
  "## Examples",
  "second",
  "",
].join("\n");

beforeAll(async () => {
  world = await notesWorld();
  const { auth } = await signedIn(world, "ada");
  const token = await apiToken(world, auth, {
    name: "answers-agent",
    permissions: ["read", "search", "create", "edit", "move"],
  });
  agent = await connectMcp(world.server, token.token);
  box = (await tool(agent, "create_folder", { name: "Box" })).data.id as string;
  await tool(agent, "create_folder", { name: "Inner", parent_id: box });
});

describe("sections", () => {
  it("refuses a heading that occurs twice and finds a path by its end", async () => {
    await tool(agent, "create_note", { folder_id: box, title: "Naming", body: NAMING });
    const twice = await tool(agent, "read_section", { note: "Box/Naming", section: "Examples" });
    expect(twice).toMatchObject({
      isError: true,
      data: {
        error: "ambiguous_section",
        candidates: ["Naming > Examples", "Naming > Examples (2)"],
      },
    });
    const write = await tool(agent, "replace_section", {
      note: "Box/Naming",
      expected_version: 1,
      section: "examples",
      body: "## Examples\nlost\n",
    });
    expect(write.data.error).toBe("ambiguous_section");
    const [row] = await world.db.sql`select version, body from notes where title = 'Naming'`;
    expect(row).toEqual({ version: 1, body: NAMING });
    const apps = await tool(agent, "read_section", { note: "Box/Naming", section: "parts > apps" });
    expect(apps.data.section).toMatchObject({ path: "Naming > Parts > Apps", hasMore: false });
    const second = await tool(agent, "read_section", {
      note: "Box/Naming",
      section: "Examples (2)",
    });
    expect((second.data.section as { text: string }).text).toBe("## Examples\nsecond\n");
  });

  it("reads a section above the budget in pieces that end at line breaks", async () => {
    const line = (i: number) => `Line ${i}: ${"word ".repeat(30)}\n`;
    const body = `## Long\n${Array.from({ length: 260 }, (_, i) => line(i)).join("")}`;
    const created = await tool(agent, "create_note", { title: "Long", body });
    const warning = (created.data.warnings as { code: string; message: string }[])[0];
    expect(warning).toMatchObject({ code: "section_over_budget", path: "Long" });
    expect(warning?.message).toContain("offset/limit");
    let offset: number | null = 0;
    let joined = "";
    let pieces = 0;
    while (offset !== null) {
      const piece = await tool(agent, "read_section", {
        note: "/Long",
        section: "Long",
        offset,
        limit: 12_000,
      });
      const section = piece.data.section as {
        text: string;
        offset: number;
        total: number;
        returned: number;
        nextOffset: number | null;
        hasMore: boolean;
      };
      expect(section.offset).toBe(offset);
      expect(section.returned).toBe([...section.text].length);
      expect(section.returned).toBeLessThanOrEqual(12_000);
      if (section.hasMore) expect(section.text.endsWith("\n")).toBe(true);
      joined += section.text;
      offset = section.nextOffset;
      pieces += 1;
    }
    expect(pieces).toBe(4);
    expect(joined).toBe(body);
  });
});

describe("answers of writes", () => {
  it("create_note and move_note give the path; title_taken names the holder", async () => {
    const created = await tool(agent, "create_note", { folder_id: box, title: "Mover", body: "" });
    expect(created.data).toMatchObject({ folderPath: "Box", path: "Box/Mover", version: 1 });
    const inner = (await tool(agent, "list_folder", { folder_id: box })).data.folders as {
      id: string;
    }[];
    const moved = await tool(agent, "move_note", {
      note: created.data.id,
      expected_version: 1,
      folder_id: inner[0]?.id,
      reason: "tidy",
    });
    expect(moved.data).toMatchObject({ path: "Box/Inner/Mover", folderPath: "Box/Inner" });
    const taken = await tool(agent, "create_note", {
      folder_id: inner[0]?.id,
      title: "MOVER",
      body: "",
    });
    expect(taken.data).toMatchObject({
      error: "title_taken",
      existingNoteId: created.data.id,
      path: "Box/Inner/Mover",
    });
    await tool(agent, "create_note", { folder_id: inner[0]?.id, title: "Other", body: "" });
    const rename = await tool(agent, "update_note", {
      note: "Box/Inner/Other",
      expected_version: 1,
      title: "mover",
    });
    expect(rename.data).toMatchObject({ error: "title_taken", existingNoteId: created.data.id });
    const [count] = await world.db
      .sql`select count(*)::int as n from notes where lower(title) = 'mover'`;
    expect(count?.n).toBe(1);
  });

  it("version_conflict says what the newer version changed", async () => {
    await tool(agent, "create_note", { title: "Shared", body: "# A\none\n\n# B\ntwo\n" });
    await tool(agent, "replace_section", {
      note: "/Shared",
      expected_version: 1,
      section: "B",
      body: "# B\nthree\n",
      reason: "fix B",
    });
    const stale = await tool(agent, "update_note", {
      note: "/Shared",
      expected_version: 1,
      body: "x",
    });
    expect(stale.data).toMatchObject({
      error: "version_conflict",
      currentVersion: 2,
      lastChange: { change: "edited", reason: "fix B", sectionPath: "B" },
    });
    await tool(agent, "update_note", { note: "/Shared", expected_version: 2, title: "Shared2" });
    const again = await tool(agent, "update_note", {
      note: "/Shared2",
      expected_version: 2,
      body: "x",
    });
    expect(again.data.lastChange).toEqual({ change: "renamed", reason: null, sectionPath: null });
  });
});

describe("listings", () => {
  it("list_folder marks folders it did not open, with their counts", async () => {
    const root = await tool(agent, "list_folder", {});
    const listed = (root.data.folders as Record<string, unknown>[])[0];
    expect(listed).toEqual({
      id: box,
      name: "Box",
      path: "Box",
      folderCount: 1,
      noteCount: 1,
      loaded: false,
    });
    const deeper = await tool(agent, "list_folder", { depth: 2 });
    expect((deeper.data.folders as Record<string, unknown>[])[0]).toMatchObject({
      loaded: true,
      folders: [{ name: "Inner", loaded: false, noteCount: 2 }],
    });
  });

  it("search snippets show … where text is left out", async () => {
    const words = Array.from({ length: 80 }, (_, i) => `filler${i}`).join(" ");
    await tool(agent, "create_note", {
      title: "Haystack",
      body: `# Hay\n${words} zebrafish ${words}\n`,
    });
    const found = await tool(agent, "search_notes", { query: "zebrafish" });
    const [hit] = found.data.hits as { snippet: string }[];
    expect(hit?.snippet).toMatch(/^… .*«zebrafish».* …$/);
  });
});
