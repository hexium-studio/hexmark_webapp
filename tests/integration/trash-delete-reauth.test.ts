import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  reauthenticated,
  signedIn,
} from "./notes-api-harness";
import { tableCounts, trashApi, trashTree } from "./trash-harness";

// Deleting from the trash for good, and emptying it, need the password
// re-entered in the session within the last 10 minutes, like creating an
// API token: decided by the service on the locked session row, inside the
// transaction that deletes. Refused, nothing goes; re-entered, it works.

let world: NotesWorld;
let ada: Auth;
let adaId: string;
let root: Auth;
let rootId: string;

beforeAll(async () => {
  world = await notesWorld();
  // Signed in without re-entering the password.
  ({ auth: ada, id: adaId } = await signedIn(world, "ada", "user", false));
  ({ auth: root, id: rootId } = await signedIn(world, "root", "admin", false));
});

const send = (auth: Auth, method: "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, auth, method, `${notesApi}${path}`, body);

// Moves the time the password was re-entered back past the 10 minutes.
async function staleReauthentication(userId: string): Promise<void> {
  await world.db
    .sql`update sessions set reauthenticated_at = now() - interval '10 minutes 5 seconds'
    where user_id = ${userId}`;
}

async function fill(prefix: string) {
  const tree = await trashTree(world, ada, prefix);
  await send(ada, "DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
  await send(ada, "DELETE", `/folders/${tree.web}`);
  return tree;
}

describe("deleting for good without recent re-authentication", () => {
  it("is refused on every endpoint, never re-entered or too long ago, and nothing goes", async () => {
    const tree = await fill("A1");
    const paths: [Auth, string][] = [
      [ada, `${trashApi}/notes/${tree.plan}`],
      [ada, `${trashApi}/folders/${tree.web}`],
      [root, trashApi],
    ];
    const before = await tableCounts(world.db);
    expect(before.notes_in_trash).toBe(3);
    for (const [auth, path] of paths) {
      const refused = await call(world.server, auth, "DELETE", path);
      expect(refused, path).toMatchObject({
        status: 403,
        body: { error: "reauthentication_required" },
      });
    }
    await reauthenticated(world.server, ada);
    await reauthenticated(world.server, root);
    await staleReauthentication(adaId);
    await staleReauthentication(rootId);
    for (const [auth, path] of paths) {
      const refused = await call(world.server, auth, "DELETE", path);
      expect(refused.body.error, path).toBe("reauthentication_required");
    }
    expect(await tableCounts(world.db)).toEqual(before);
  });

  it("tells a user who may not empty the trash that first", async () => {
    await staleReauthentication(adaId);
    const refused = await call(world.server, ada, "DELETE", trashApi);
    expect(refused).toMatchObject({
      status: 403,
      body: { error: "forbidden", reason: "admin_required" },
    });
  });
});

describe("deleting for good with the password re-entered", () => {
  it("removes a note, a folder, and empties the trash", async () => {
    const tree = await fill("A2");
    await reauthenticated(world.server, ada);
    await reauthenticated(world.server, root);
    const before = await tableCounts(world.db);

    const note = await call(world.server, ada, "DELETE", `${trashApi}/notes/${tree.plan}`);
    expect(note).toMatchObject({ status: 200, body: { notes: 1, folders: 0 } });
    const folder = await call(world.server, ada, "DELETE", `${trashApi}/folders/${tree.web}`);
    expect(folder).toMatchObject({ status: 200, body: { notes: 2, folders: 2 } });
    const afterBoth = await tableCounts(world.db);
    expect([afterBoth.notes, afterBoth.folders]).toEqual([before.notes - 3, before.folders - 2]);

    await fill("A3");
    const full = await tableCounts(world.db);
    const emptied = await call(world.server, root, "DELETE", trashApi);
    expect(emptied).toMatchObject({
      status: 200,
      body: { notes: full.notes_in_trash, folders: full.folders_in_trash },
    });
    expect(await tableCounts(world.db)).toMatchObject({ notes_in_trash: 0, folders_in_trash: 0 });
  });
});
