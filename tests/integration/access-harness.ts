import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectMcp } from "./mcp-harness";
import {
  type Auth,
  apiToken,
  createFolder,
  createNote,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// The wiki of the allow_list tests (access-allow-list*.test.ts): Shared >
// Deep > Deeper and Private > Inner with notes in each, "Twin" three times,
// and a token listing the folder Deep (at depth two) and the single note
// Lonely in Private/Inner.

export const WORD = "zebracorn";

export const note = (title: string, folderId: string | null) => ({
  folderId,
  title,
  body: `# ${title}\n\nThe ${WORD} lives here.\n`,
});

type Key =
  | "deep"
  | "deepNote"
  | "deeper"
  | "inner"
  | "lonely"
  | "private"
  | "root"
  | "secret"
  | "shared"
  | "sharedNote"
  | "twinDeep"
  | "twinDeeper"
  | "twinPrivate";

export interface AllowListWorld {
  world: NotesWorld;
  ada: Auth;
  agent: Auth;
  mcp: Client;
  ids: Record<Key, string>;
}

export async function allowListWorld(): Promise<AllowListWorld> {
  const world = await notesWorld();
  const { auth: ada } = await signedIn(world, "ada", "admin");
  const ids = {} as Record<Key, string>;
  ids.shared = await createFolder(world, ada, "Shared");
  ids.deep = await createFolder(world, ada, "Deep", ids.shared);
  ids.deeper = await createFolder(world, ada, "Deeper", ids.deep);
  ids.private = await createFolder(world, ada, "Private");
  ids.inner = await createFolder(world, ada, "Inner", ids.private);
  ids.root = await createNote(world, ada, note("Root note", null));
  ids.sharedNote = await createNote(world, ada, note("Shared note", ids.shared));
  ids.deepNote = await createNote(world, ada, note("Deep note", ids.deeper));
  ids.secret = await createNote(world, ada, note("Secret", ids.private));
  ids.lonely = await createNote(world, ada, note("Lonely", ids.inner));
  ids.twinDeep = await createNote(world, ada, note("Twin", ids.deep));
  ids.twinDeeper = await createNote(world, ada, note("Twin", ids.deeper));
  ids.twinPrivate = await createNote(world, ada, note("Twin", ids.private));
  const created = await apiToken(world, ada, {
    name: "listed",
    mode: "allow_list",
    entries: [
      { kind: "folder", id: ids.deep, permissions: ["read", "search", "create", "edit", "move"] },
      { kind: "note", id: ids.lonely, permissions: ["read"] },
    ],
  });
  return {
    world,
    ada,
    agent: created.auth,
    mcp: await connectMcp(world.server, created.token),
    ids,
  };
}
