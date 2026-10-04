import { beforeAll, describe, expect, it } from "vitest";
import {
  expectNoLeak,
  type HiddenWorld,
  hiddenWorld,
  INNER_FOLDER,
  INNER_NOTE,
  SECRET,
  VAULT_NOTE,
} from "./hidden-harness";
import { connectMcp, tool } from "./mcp-harness";
import { apiToken, call, notesApi } from "./notes-api-harness";

// What an agent reads of hidden items, on every read path: a hidden note's
// title and path but never its content, a hidden folder but nothing below
// it. Every answer is checked for the secret word and the names below the
// hidden folder; people read everything as before. Search:
// hidden-search.test.ts.

let h: HiddenWorld;
const answers: unknown[] = [];
const ask = async (name: string, args: Record<string, unknown> = {}) => {
  const answer = await tool(h.mcp, name, args);
  answers.push(answer);
  return answer;
};

beforeAll(async () => {
  h = await hiddenWorld();
});

describe("reading a hidden note", () => {
  it("refuses its content with hidden, naming title and path", async () => {
    for (const [name, args] of [
      ["read_note", { note: h.ids.diary }],
      ["read_outline", { note: "Open/Diary" }],
      ["read_section", { note: "Diary", section: "Diary" }],
      ["read_revision", { note: h.ids.diary, version: 1 }],
    ] as const) {
      const answer = await ask(name, args);
      expect(answer.isError, name).toBe(true);
      expect(answer.data, name).toMatchObject({
        error: "hidden",
        hiddenItem: { kind: "note", id: h.ids.diary, path: "Open/Diary" },
        title: "Diary",
        hiddenBy: "ada",
        reason: "Private",
      });
      expect(answer.data, name).not.toHaveProperty("locked");
    }
  });

  it("lists its revisions and changes without the section an edit changed", async () => {
    const revisions = await ask("list_revisions", { note: h.ids.diary });
    const listed = revisions.data.revisions as { version: number; sectionPath: unknown }[];
    expect(listed.map((revision) => revision.version)).toEqual([2, 1]);
    expect(listed.every((revision) => revision.sectionPath === null)).toBe(true);
    const changes = await ask("list_changes", { since: "2000-01-01T00:00:00Z" });
    const entries = changes.data.changes as {
      title: string;
      sectionPath: unknown;
      hidden: unknown;
    }[];
    const diary = entries.find((entry) => entry.title === "Diary");
    expect(diary).toMatchObject({
      sectionPath: null,
      hidden: { by: "ada", reason: "Private", inherited: false, from: { id: h.ids.diary } },
    });
    expect(entries.map((entry) => entry.title).sort()).toEqual(["Diary", "Plain"]);
    // People see the section path.
    const human = await call(
      h.world.server,
      h.ada,
      "GET",
      `${notesApi}/notes/${h.ids.diary}/revisions`,
    );
    expect((human.body.revisions as { sectionPath: unknown }[])[0]?.sectionPath).toContain(SECRET);
  });

  it("is readable as before for people", async () => {
    const human = await call(h.world.server, h.ada, "GET", `${notesApi}/notes/${h.ids.diary}`);
    expect(human.status).toBe(200);
    const note = human.body.note as { body: string; hidden: Record<string, unknown> };
    expect(note.body).toContain(SECRET);
    expect(note.hidden).toMatchObject({ by: "ada", inherited: false });
  });
});

describe("the hidden folder", () => {
  it("shows the folder without contents or counts, and refuses to list it", async () => {
    const overview = await ask("get_overview");
    const tree = overview.data.tree as { folders: Record<string, unknown>[] };
    const vault = tree.folders.find((folder) => folder.name === "Vault");
    expect(vault).toMatchObject({
      folderCount: null,
      noteCount: null,
      loaded: false,
      hidden: { from: { kind: "folder", id: h.ids.vault, path: "Vault" } },
    });
    expect(overview.data.counts).toEqual({ notes: 2, folders: 2 });
    const root = await ask("list_folder", { depth: 5 });
    expect(JSON.stringify(root.data)).toContain('"Vault"');
    const listed = await ask("list_folder", { folder_id: h.ids.vault });
    expect(listed.data).toMatchObject({ error: "hidden", hiddenItem: { id: h.ids.vault } });
    const inner = await ask("list_folder", { folder_id: h.ids.inner });
    expect(inner.data).toMatchObject({ error: "folder_not_found" });
  });

  it("does not know anything below it, by id, title or path", async () => {
    for (const note of [h.ids.vaultNote, VAULT_NOTE, `Vault/${VAULT_NOTE}`, h.ids.innerNote]) {
      expect((await ask("read_note", { note })).data, note).toMatchObject({ error: "not_found" });
    }
    for (const note of [`Vault/${INNER_FOLDER}/${INNER_NOTE}`, INNER_NOTE]) {
      expect((await ask("list_revisions", { note })).data).toMatchObject({ error: "not_found" });
    }
  });

  it("never names a note below it among ambiguous candidates", async () => {
    await call(h.world.server, h.ada, "POST", `${notesApi}/notes`, {
      folderId: h.ids.inner,
      title: "Plain",
      body: "twin",
    });
    const answer = await ask("read_note", { note: "Plain" });
    expect(answer.isError).toBe(false);
    expect((answer.data.note as { id: string }).id).toBe(h.ids.plain);
  });

  it("keeps what lies below it out of the trash listing", async () => {
    const trashed = await call(
      h.world.server,
      h.ada,
      "DELETE",
      `${notesApi}/folders/${h.ids.inner}`,
      {
        reason: "Old",
      },
    );
    expect(trashed.status).toBe(200);
    const human = await call(h.world.server, h.ada, "GET", `${notesApi}/trash`);
    expect(JSON.stringify(human.body)).toContain(INNER_FOLDER);
    const trash = await ask("list_trash");
    expect(trash.data.entries).toEqual([]);
    expect((await ask("restore_folder", { folder_id: h.ids.inner })).data).toMatchObject({
      error: "folder_not_found",
    });
    const back = await call(
      h.world.server,
      h.ada,
      "POST",
      `${notesApi}/folders/${h.ids.inner}/restore`,
      {},
    );
    expect(back.status).toBe(200);
  });

  it("is left out of an allow list's entries when it lies below the hidden folder", async () => {
    const listed = await apiToken(h.world, h.ada, {
      name: "listed",
      mode: "allow_list",
      entries: [
        { kind: "folder", id: h.ids.inner, permissions: ["read", "search"] },
        { kind: "note", id: h.ids.vaultNote, permissions: ["read"] },
        { kind: "folder", id: h.ids.open, permissions: ["read"] },
      ],
    });
    const client = await connectMcp(h.world.server, listed.token);
    const overview = await tool(client, "get_overview");
    answers.push(overview);
    const entries = (overview.data.access as { entries: { path: string }[] }).entries;
    expect(entries.map((entry) => entry.path)).toEqual(["Open"]);
    const inner = await tool(client, "list_folder", { folder_id: h.ids.inner });
    answers.push(inner);
    expect(inner.data).toMatchObject({ error: "folder_not_found" });
    const note = await tool(client, "read_note", { note: h.ids.vaultNote });
    answers.push(note);
    expect(note.data).toMatchObject({ error: "not_found" });
  });

  it("leaked nothing in any answer of this file", () => {
    expect(expectNoLeak(answers)).toBe(22);
  });
});
