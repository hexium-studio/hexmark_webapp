import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
import { type Auth, apiToken, type NotesWorld, notesWorld, signedIn } from "./notes-api-harness";

// What the fourth agent test asked for: search snippets that keep an emoji
// and the final period at the end of a short section (and a closing code
// fence), hyphenated words marked as one, name_taken naming the folder that
// holds the name, the reading notice as `notice`, in_trash with its batch
// and path, and restore_folder counting what came back.

let world: NotesWorld;
let ada: Auth;
let agent: Client;
let folderId: string;

const BODY = [
  "# Teile",
  "",
  "## Apps",
  "",
  "Jede App heißt app-kalender oder ähnlich, die Länge spielt keine Rolle 🚀.",
  "",
  "## Beispiele",
  "",
  "```",
  "lib-zeitzonen",
  "```",
  "",
].join("\n");

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  const token = await apiToken(world, ada, {
    name: "run-4",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  agent = await connectMcp(world.server, token.token);
  folderId = (await tool(agent, "create_folder", { name: "Lauf" })).data.id as string;
  await tool(agent, "create_note", { folder_id: folderId, title: "Namen", body: BODY });
});

const hits = async (query: string) =>
  (await tool(agent, "search_notes", { query })).data.hits as {
    sectionPath: string;
    snippet: string;
  }[];

describe("search snippets", () => {
  it("keep an emoji and the final period at the end of a short section, without …", async () => {
    const [hit] = await hits("rolle");
    expect(hit?.sectionPath).toBe("Teile > Apps");
    expect(hit?.snippet.endsWith("keine «Rolle» 🚀.")).toBe(true);
    expect(hit?.snippet).not.toContain("…");
  });

  it("keep a closing code fence instead of dropping it", async () => {
    const [hit] = await hits("zeitzonen");
    expect(hit?.snippet).toContain("```");
    expect(hit?.snippet.trim().endsWith("```")).toBe(true);
    expect(hit?.snippet).not.toContain("…");
  });

  it("mark a hyphenated word as one when both parts match", async () => {
    const [hit] = await hits("app-kalender");
    expect(hit?.snippet).toContain("«app-kalender»");
    expect(hit?.snippet).not.toContain("«app»-«kalender»");
  });
});

describe("answers", () => {
  it("name_taken names the folder holding the name, with a way on", async () => {
    const holder = (await tool(agent, "create_folder", { parent_id: folderId, name: "Ablage" }))
      .data;
    const other = (await tool(agent, "create_folder", { parent_id: folderId, name: "Konzepte" }))
      .data;
    const taken = await tool(agent, "rename_folder", { folder_id: other.id, name: "ablage" });
    expect(taken).toMatchObject({
      isError: true,
      data: { error: "name_taken", existingFolderId: holder.id, path: "Lauf/Ablage" },
    });
    expect(taken.data.message).toContain("existingFolderId, path");
    expect(taken.data.message).not.toContain("when restoring");
  });

  it("read_section says `notice` past the end", async () => {
    const answer = await tool(agent, "read_section", {
      note: "Lauf/Namen",
      section: "Apps",
      offset: 9999,
    });
    const section = answer.data.section as Record<string, unknown>;
    expect(section.notice).toMatch(/^offset is past the end/);
    expect(section).not.toHaveProperty("note");
  });

  it("restore_folder counts what came back, with the batch", async () => {
    const box = (await tool(agent, "create_folder", { parent_id: folderId, name: "Kiste" })).data;
    await tool(agent, "create_folder", { parent_id: box.id, name: "Innen" });
    await tool(agent, "create_note", { folder_id: box.id, title: "Inhalt", body: "x" });
    const deleted = await tool(agent, "delete_folder", { folder_id: box.id });
    const restored = await tool(agent, "restore_folder", { folder_id: box.id });
    expect(restored.data).toEqual({
      id: box.id,
      name: "Kiste",
      path: "Lauf/Kiste",
      batchId: deleted.data.batchId,
      restoredSubfolders: 1,
      restoredNotes: 1,
    });
  });
});
