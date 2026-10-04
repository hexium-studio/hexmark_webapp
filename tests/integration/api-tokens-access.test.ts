import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// /api/tokens/v1: the access of a new token - the rules that depend on its
// mode, and the entries as stored and listed (paths, the trash flag).

const tokensPath = "/api/tokens/v1/tokens";

let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
});

describe("the access of a new token", () => {
  it("checks the rules that depend on the mode", async () => {
    const folder = await createFolder(world, ada, "Rules");
    const post = (body: Record<string, unknown>) =>
      call(world.server, ada, "POST", tokensPath, { name: "rules", ...body });
    const fields = async (body: Record<string, unknown>) => (await post(body)).body.fields;
    // allow_list: at least one entry, each with permissions; no base set.
    expect(await fields({ mode: "allow_list", entries: [] })).toEqual({
      entries: { code: "required" },
    });
    expect(await fields({ mode: "allow_list", entries: [{ kind: "folder", id: folder }] })).toEqual(
      { entries: { code: "required", params: { index: 0 } } },
    );
    const listed = [{ kind: "folder", id: folder, permissions: ["read"] }];
    expect(
      await fields({ mode: "allow_list", basePermissions: ["read"], entries: listed }),
    ).toEqual({ basePermissions: { code: "invalid" } });
    // deny_list: entries without permissions.
    expect(await fields({ mode: "deny_list", basePermissions: ["read"], entries: listed })).toEqual(
      { entries: { code: "invalid", params: { index: 0 } } },
    );
    // A target listed twice.
    expect(await fields({ mode: "allow_list", entries: [...listed, ...listed] })).toEqual({
      entries: { code: "invalid", params: { index: 1 } },
    });
    // A note entry cannot carry create or search.
    const noteId = (
      await call(world.server, ada, "POST", "/api/notes/v1/notes", {
        folderId: folder,
        title: "Rules note",
        body: "x",
      })
    ).body.id as string;
    for (const permission of ["create", "search"]) {
      expect(
        await fields({
          mode: "allow_list",
          entries: [{ kind: "note", id: noteId, permissions: ["read", permission] }],
        }),
      ).toEqual({ entries: { code: "invalid_option", params: { index: 0 } } });
    }
    const [count] = await world.db
      .sql`select count(*)::int as n from api_tokens where name = 'rules'`;
    expect(count?.n).toBe(0);
  });

  it("stores an allow list and lists its entries with paths and the trash flag", async () => {
    const folder = await createFolder(world, ada, "Scoped");
    const inner = await createFolder(world, ada, "Inner", folder);
    const noteId = (
      await call(world.server, ada, "POST", "/api/notes/v1/notes", {
        folderId: inner,
        title: "Listed",
        body: "x",
      })
    ).body.id as string;
    const token = await apiToken(world, ada, {
      name: "folder-agent",
      mode: "allow_list",
      entries: [
        { kind: "folder", id: folder, permissions: ["search", "read"] },
        { kind: "note", id: noteId, permissions: ["edit"] },
      ],
    });
    const rows = await world.db.sql`
      select target_kind, folder_id, note_id, permissions, token_access_mode
      from api_token_entries where token_id = ${token.id} order by target_kind`;
    expect(rows).toEqual([
      {
        target_kind: "folder",
        folder_id: folder,
        note_id: null,
        permissions: ["read", "search"],
        token_access_mode: "allow_list",
      },
      {
        target_kind: "note",
        folder_id: null,
        note_id: noteId,
        permissions: ["edit"],
        token_access_mode: "allow_list",
      },
    ]);
    const listed = async () => {
      const list = await call(world.server, ada, "GET", tokensPath);
      return (list.body.tokens as { id: string }[]).find((item) => item.id === token.id);
    };
    expect(await listed()).toMatchObject({
      mode: "allow_list",
      basePermissions: null,
      entries: [
        {
          kind: "folder",
          targetId: folder,
          path: "Scoped",
          targetTrashed: false,
          permissions: ["read", "search"],
        },
        {
          kind: "note",
          targetId: noteId,
          path: "Scoped/Inner/Listed",
          targetTrashed: false,
          permissions: ["edit"],
        },
      ],
    });
    // A target in the trash keeps its entry.
    await call(world.server, ada, "DELETE", `/api/notes/v1/folders/${folder}`, {});
    expect(await listed()).toMatchObject({
      entries: [
        { targetId: folder, path: "Scoped", targetTrashed: true },
        { targetId: noteId, path: "Scoped/Inner/Listed", targetTrashed: true },
      ],
    });
  });
});
