import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect } from "vitest";
import { connectMcp } from "./mcp-harness";
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

// The wiki of the hidden tests (hidden-*.test.ts): Open (visible) holding
// the note Plain and the hidden note Diary, whose body and a heading carry a
// secret word; Vault (hidden) holding the note Marmotplan and the folder
// Wombatroom with the note Inner note - all three names, and the secret
// word, unique in the wiki. Ada (admin) hid both; the agent has every
// permission on the whole wiki (deny_list without entries).

// Unique words: none of them may reach an agent, in any answer.
export const SECRET = "quokkasecret";
export const VAULT_NOTE = "Marmotplan";
export const INNER_FOLDER = "Wombatroom";
export const INNER_NOTE = "Lemurletter";
export const LEAKS = [SECRET, VAULT_NOTE, INNER_FOLDER, INNER_NOTE, "Vault/"];

export const ALL = ["read", "search", "create", "edit", "move", "delete", "lock", "hide"];

type Key = "open" | "plain" | "diary" | "vault" | "vaultNote" | "inner" | "innerNote";

export interface HiddenWorld {
  world: NotesWorld;
  ada: Auth;
  agent: Auth;
  agentId: string;
  mcp: Client;
  ids: Record<Key, string>;
}

export const hiddenRow = async (world: NotesWorld, table: "notes" | "folders", id: string) =>
  (
    await world.db.sql`
      select hidden_at, hidden_by_name, hidden_by_user_id, hidden_by_token_id, hide_reason
      from ${world.db.sql(table)} where id = ${id}`
  )[0];

export async function hiddenWorld(): Promise<HiddenWorld> {
  const world = await notesWorld();
  const { auth: ada } = await signedIn(world, "ada", "admin");
  const ids = {} as Record<Key, string>;
  ids.open = await createFolder(world, ada, "Open");
  ids.plain = await createNote(world, ada, {
    folderId: ids.open,
    title: "Plain",
    body: "# Plain\n\nNothing to hide here.\n",
  });
  ids.diary = await createNote(world, ada, {
    folderId: ids.open,
    title: "Diary",
    body: `# Diary\n\nIntro.\n\n## The ${SECRET} plan\n\nThe ${SECRET} is kept here.\n`,
  });
  // A section edit, so the history records a section path (a heading).
  const edited = await call(world.server, ada, "PUT", `${notesApi}/notes/${ids.diary}/sections`, {
    expectedVersion: 1,
    heading: `The ${SECRET} plan`,
    body: `## The ${SECRET} plan\n\nThe ${SECRET} moved.\n`,
    reason: "Update",
  });
  expect(edited.status).toBe(200);
  ids.vault = await createFolder(world, ada, "Vault");
  ids.vaultNote = await createNote(world, ada, {
    folderId: ids.vault,
    title: VAULT_NOTE,
    body: `The ${SECRET} map.\n`,
  });
  ids.inner = await createFolder(world, ada, INNER_FOLDER, ids.vault);
  ids.innerNote = await createNote(world, ada, {
    folderId: ids.inner,
    title: INNER_NOTE,
    body: `# ${SECRET}\n\nDeep inside.\n`,
  });
  for (const path of [`/notes/${ids.diary}/hide`, `/folders/${ids.vault}/hide`]) {
    const hidden = await call(world.server, ada, "POST", `${notesApi}${path}`, {
      reason: "Private",
    });
    expect(hidden.status, path).toBe(200);
  }
  const created = await apiToken(world, ada, {
    name: "seeker",
    mode: "deny_list",
    basePermissions: ALL,
  });
  return {
    world,
    ada,
    agent: created.auth,
    agentId: created.id,
    mcp: await connectMcp(world.server, created.token),
    ids,
  };
}

// No answer an agent got may contain anything of the hidden content or of
// what lies below the hidden folder. Returns how many answers were checked,
// so a test can show that the check saw something.
export function expectNoLeak(answers: readonly unknown[]): number {
  for (const answer of answers) {
    const text = JSON.stringify(answer);
    for (const word of LEAKS) expect(text, `"${word}" leaked`).not.toContain(word);
  }
  return answers.length;
}
