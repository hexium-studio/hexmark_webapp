import { beforeAll, describe, expect, it } from "vitest";
import { connectMcp, tool } from "./mcp-harness";
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

// A token limited to folders never learns the id or path of a folder outside
// them: not from a note's history (a note moved in from elsewhere), not from
// the parent of its top folder. Callers without that limit see both.

let world: NotesWorld;
let ada: Auth;
let secret: string;
let inside: string;
let movedNote: string;
let rootNote: string;

interface Revision {
  version: number;
  folderId: string | null;
  folderPath: string | null;
  folderOutsideScope: boolean;
}

async function moveInside(id: string): Promise<void> {
  const moved = await call(world.server, ada, "POST", `${notesApi}/notes/${id}/move`, {
    expectedVersion: 1,
    folderId: inside,
  });
  if (moved.status !== 200) throw new Error(`move failed: ${JSON.stringify(moved)}`);
}

const revisions = async (auth: Auth, id: string) =>
  (await call(world.server, auth, "GET", `${notesApi}/notes/${id}/revisions`)).body
    .revisions as Revision[];

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  secret = await createFolder(world, ada, "Secret plans");
  inside = await createFolder(world, ada, "Shared", secret);
  movedNote = await createNote(world, ada, { folderId: secret, title: "Roadmap", body: "x" });
  rootNote = await createNote(world, ada, { title: "Loose", body: "y" });
  await moveInside(movedNote);
  await moveInside(rootNote);
});

describe("revision history of a note moved into the scope", () => {
  it("hides the folder outside the scope from a scoped token (HTTP)", async () => {
    const scoped = await apiToken(world, ada, {
      name: "scoped",
      permissions: ["read"],
      folderScope: [inside],
    });
    const list = await revisions(scoped.auth, movedNote);
    expect(list).toHaveLength(2);
    expect(list).toMatchObject([
      {
        version: 2,
        folderId: inside,
        folderPath: "Secret plans/Shared",
        folderOutsideScope: false,
      },
      { version: 1, folderId: null, folderPath: null, folderOutsideScope: true },
    ]);
    const one = await call(
      world.server,
      scoped.auth,
      "GET",
      `${notesApi}/notes/${movedNote}/revisions/1`,
    );
    expect(one.status).toBe(200);
    expect(one.body.revision).toMatchObject({
      folderId: null,
      folderPath: null,
      folderOutsideScope: true,
      body: "x",
    });
    // The root level is outside a scoped token's folders too.
    expect((await revisions(scoped.auth, rootNote)).at(-1)).toMatchObject({
      folderId: null,
      folderPath: null,
      folderOutsideScope: true,
    });
    expect(JSON.stringify(list) + JSON.stringify(one.body)).not.toContain(secret);
  });

  it("shows the folder to an unscoped token and a session", async () => {
    const whole = await apiToken(world, ada, { name: "whole", permissions: ["read"] });
    for (const auth of [whole.auth, ada]) {
      const list = await revisions(auth, movedNote);
      expect(list.at(-1)).toEqual(
        expect.objectContaining({
          version: 1,
          folderId: secret,
          folderPath: "Secret plans",
          folderOutsideScope: false,
        }),
      );
      expect((await revisions(auth, rootNote)).at(-1)).toMatchObject({
        folderId: null,
        folderPath: "",
        folderOutsideScope: false,
      });
    }
  });

  it("hides it over MCP as well", async () => {
    const scoped = await apiToken(world, ada, {
      name: "scoped-mcp",
      permissions: ["read"],
      folderScope: [inside],
    });
    const client = await connectMcp(world.server, scoped.token);
    const list = await tool(client, "list_revisions", { note: movedNote });
    expect(list.isError).toBe(false);
    expect((list.data.revisions as Revision[]).at(-1)).toMatchObject({
      folderId: null,
      folderPath: null,
      folderOutsideScope: true,
    });
    const one = await tool(client, "read_revision", { note: movedNote, version: 1 });
    expect(one.data).toMatchObject({ folderId: null, folderPath: null, folderOutsideScope: true });
    expect(JSON.stringify(list.data) + JSON.stringify(one.data)).not.toContain(secret);
    const whole = await apiToken(world, ada, { name: "whole-mcp", permissions: ["read"] });
    const open = await tool(await connectMcp(world.server, whole.token), "read_revision", {
      note: movedNote,
      version: 1,
    });
    expect(open.data).toMatchObject({ folderId: secret, folderPath: "Secret plans" });
  });
});

describe("folder answers", () => {
  it("hides the parent of a scoped token's top folder, not of folders inside", async () => {
    const editor = await apiToken(world, ada, {
      name: "folder-editor",
      permissions: ["read", "edit", "create"],
      folderScope: [inside],
    });
    const rename = (auth: Auth, name: string) =>
      call(world.server, auth, "PATCH", `${notesApi}/folders/${inside}`, { name });
    const renamed = await rename(editor.auth, "Shared work");
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: inside, parentId: null, parentOutsideScope: true });
    expect(JSON.stringify(renamed.body)).not.toContain(secret);
    const child = await call(world.server, editor.auth, "POST", `${notesApi}/folders`, {
      parentId: inside,
      name: "Drafts",
    });
    expect(child.body).toMatchObject({ parentId: inside, parentOutsideScope: false });
    const asSession = await rename(ada, "Shared");
    expect(asSession.body).toMatchObject({ parentId: secret, parentOutsideScope: false });
  });
});
