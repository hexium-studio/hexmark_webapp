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
import { tool } from "./mcp-harness";
import { call, notesApi } from "./notes-api-harness";

// Searching with hidden items: a secret word in a hidden note's body and
// heading, and in notes below a hidden folder, gives an agent zero hits -
// while people find all three, so the search can find it - and no answer
// names anything below the folder. A hidden note is found by its title
// only; searching inside the hidden folder is refused.

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

describe("search", () => {
  it("finds nothing of the hidden content or below the hidden folder", async () => {
    // People find the secret word in all three notes: the search can find it.
    const human = await call(h.world.server, h.ada, "GET", `${notesApi}/search?q=${SECRET}`);
    expect(human.status).toBe(200);
    const humanHits = human.body.hits as { title: string }[];
    expect(humanHits.map((hit) => hit.title).sort()).toEqual(["Diary", INNER_NOTE, VAULT_NOTE]);
    // The leak check sees it in their answer: it measures something.
    expect(() => expectNoLeak([human.body])).toThrow();
    for (const query of [SECRET, VAULT_NOTE, INNER_NOTE, INNER_FOLDER, `"${SECRET} plan"`]) {
      const answer = await ask("search_notes", { query });
      expect(answer.isError, query).toBe(false);
      expect(answer.data.hits, query).toEqual([]);
    }
  });

  it("finds a hidden note by its title only, without section or snippet", async () => {
    const answer = await ask("search_notes", { query: "Diary" });
    const hits = answer.data.hits as Record<string, unknown>[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      noteId: h.ids.diary,
      title: "Diary",
      folderPath: "Open",
      sectionPath: null,
      heading: null,
      snippet: "",
      hidden: { by: "ada", reason: "Private", inherited: false },
    });
    // People get the sections, with the hidden state.
    const human = await call(h.world.server, h.ada, "GET", `${notesApi}/search?q=Diary`);
    const humanHits = human.body.hits as { sectionPath: string | null; hidden: unknown }[];
    expect(humanHits.length).toBeGreaterThan(0);
    expect(humanHits.every((hit) => hit.sectionPath !== null && hit.hidden !== null)).toBe(true);
  });

  it("refuses to search inside the hidden folder and does not know what is below it", async () => {
    const inside = await ask("search_notes", { query: SECRET, folder_id: h.ids.vault });
    expect(inside.data).toMatchObject({
      error: "hidden",
      hiddenItem: { kind: "folder", id: h.ids.vault, path: "Vault" },
    });
    const below = await ask("search_notes", { query: "x", folder_id: h.ids.inner });
    expect(below.data).toMatchObject({ error: "folder_not_found" });
  });

  it("leaked nothing in any answer", () => {
    expect(expectNoLeak(answers)).toBe(8);
  });
});
