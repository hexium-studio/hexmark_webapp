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

// What the agent test asked for, answered by the running server: search
// hits with heading and text apart, punctuation kept, phrases as one mark
// and relative ranks; sizes in characters; who changed a listed note and
// how; the blank line replace_section adds; reading past the end; and the
// message of a write that changed nothing.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let noteId: string;

const BODY =
  "Intro line.\n\n# Naming\n\n## Rule\n\nWords are separated by an underscore (ä becomes ae).\n\n" +
  "## Libraries\n\nShared code lives in the Quetschkommode.\n\n## Apps\n\nShort app names.\n";

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "polish-agent",
    permissions: ["read", "search", "create", "edit"],
  });
  agent = await connectMcp(world.server, token.token);
  const created = await tool(agent, "create_note", { title: "Conventions", body: BODY });
  noteId = created.data.id as string;
});

interface Hit {
  sectionPath: string;
  heading: string;
  snippet: string;
  rank: number;
}

const search = async (query: string) =>
  (await tool(agent, "search_notes", { query })).data.hits as Hit[];

describe("search hits", () => {
  it("show the heading on its own and keep the final period", async () => {
    const [hit] = await search("Quetschkommode");
    expect(hit).toMatchObject({
      sectionPath: "Naming > Libraries",
      heading: "Libraries",
      snippet: "Shared code lives in the «Quetschkommode».",
      rank: 1,
    });
  });

  it("mark a phrase as one span and keep brackets around the words", async () => {
    const [hit] = await search('"separated by"');
    expect(hit?.snippet).toBe("Words are «separated by» an underscore (ä becomes ae).");
  });

  it("mark matches in the heading", async () => {
    const [hit] = await search("libraries");
    expect(hit).toMatchObject({ heading: "Libraries", sectionPath: "Naming > Libraries" });
    expect(hit?.snippet).not.toContain("Libraries");
  });

  it("rank relative to the best hit, also with an excluded word", async () => {
    const hits = await search("names OR code -underscore");
    expect(hits.length).toBe(2);
    expect(hits[0]?.rank).toBe(1);
    for (const hit of hits) {
      expect(hit.rank).toBeGreaterThan(0);
      expect(hit.rank).toBeLessThanOrEqual(1);
      expect(String(hit.rank)).not.toContain("e-");
    }
  });
});

describe("reading and listing", () => {
  it("read_note gives the size in characters next to the token estimate", async () => {
    const read = await tool(agent, "read_note", { note: noteId });
    expect(read.data.note).toMatchObject({ characters: [...BODY].length });
  });

  it("list_folder names who wrote each note's latest version and what it changed", async () => {
    await tool(agent, "update_note", {
      note: noteId,
      expected_version: 1,
      title: "Conventions 2",
    });
    const listed = await tool(agent, "list_folder", {});
    const notes = listed.data.notes as Record<string, unknown>[];
    expect(notes.find((entry) => entry.id === noteId)).toMatchObject({
      version: 2,
      updatedBy: "polish-agent",
      lastChange: "renamed",
    });
  });

  it("read_section past the end gives an empty piece with a note; a short limit cuts a line", async () => {
    const section = { note: noteId, section: "Apps" };
    const whole = await tool(agent, "read_section", section);
    const total = (whole.data.section as { total: number }).total;
    const past = await tool(agent, "read_section", { ...section, offset: total + 10 });
    expect(past.data.section).toMatchObject({
      text: "",
      hasMore: false,
      notice: `offset is past the end (total ${total}); nothing is left to read.`,
    });
    expect(whole.data.section).not.toHaveProperty("note");
    const cut = await tool(agent, "read_section", { ...section, limit: 3 });
    expect(cut.data.section).toMatchObject({ text: "## ", nextOffset: 3, hasMore: true });
  });
});

describe("writing", () => {
  it("replace_section adds the blank line before the next heading, nothing else", async () => {
    const read = await tool(agent, "read_note", { note: noteId });
    const version = (read.data.note as { version: number }).version;
    const replaced = await tool(agent, "replace_section", {
      note: noteId,
      expected_version: version,
      section: "Naming > Rule",
      body: "## Rule\n\nKebab case,   always.\n",
    });
    expect(replaced.data).toMatchObject({ changed: true });
    const [row] = await world.db.sql`select body from notes where id = ${noteId}`;
    expect(row?.body).toContain("## Rule\n\nKebab case,   always.\n\n## Libraries\n");
  });

  it("a write that changes nothing says so in a message", async () => {
    const read = await tool(agent, "read_note", { note: noteId });
    const note = read.data.note as { version: number; body: string };
    const before = (await revisionRows(world.db, noteId)).length;
    const same = await tool(agent, "update_note", {
      note: noteId,
      expected_version: note.version,
      body: note.body,
      reason: "no-op",
    });
    expect(same.data).toMatchObject({
      changed: false,
      version: note.version,
      message:
        "Nothing differs from the current version; no revision was created and the reason was dropped.",
    });
    // Sending a section's current text back changes nothing either.
    const section = await tool(agent, "read_section", { note: noteId, section: "Apps" });
    const unchanged = await tool(agent, "replace_section", {
      note: noteId,
      expected_version: note.version,
      section: "Apps",
      body: (section.data.section as { text: string }).text,
    });
    expect(unchanged.data).toMatchObject({ changed: false, version: note.version });
    expect((await revisionRows(world.db, noteId)).length).toBe(before);
    // A write that does change something has no message.
    const changed = await tool(agent, "update_note", {
      note: noteId,
      expected_version: note.version,
      title: "Conventions 3",
    });
    expect(changed.data).toMatchObject({ changed: true });
    expect(changed.data).not.toHaveProperty("message");
  });
});
