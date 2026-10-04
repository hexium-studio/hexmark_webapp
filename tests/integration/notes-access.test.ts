import { beforeAll, describe, expect, it } from "vitest";
import {
  type Auth,
  apiToken,
  call,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// Who may do what with notes: roles, token permissions (intersected with the
// owner's role), folder scope with subfolders, revoked and expired tokens.

let world: NotesWorld;
let ada: Auth;
let inside: string;
let insideChild: string;
let outsideNote: string;
let childNote: string;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada"));
  inside = await createFolder(world, ada, "Inside");
  insideChild = await createFolder(world, ada, "Child", inside);
  const outside = await createFolder(world, ada, "Outside");
  childNote = await createNote(world, ada, { folderId: insideChild, title: "Shared", body: "in" });
  outsideNote = await createNote(world, ada, { folderId: outside, title: "Shared", body: "out" });
});

const notePath = (id: string) => `${notesApi}/notes/${id}`;

describe("roles", () => {
  it("lets a guest read and search but not write", async () => {
    const { auth: guest } = await signedIn(world, "gus", "guest");
    expect((await call(world.server, guest, "GET", notePath(childNote))).status).toBe(200);
    expect((await call(world.server, guest, "GET", `${notesApi}/search?q=in`)).status).toBe(200);
    const write = await call(world.server, guest, "PATCH", notePath(childNote), {
      expectedVersion: 1,
      body: "guest edit",
    });
    expect(write).toMatchObject({ status: 403, body: { error: "forbidden", permission: "edit" } });
    const create = await call(world.server, guest, "POST", `${notesApi}/notes`, {
      title: "Nope",
      body: "",
    });
    expect(create.body).toMatchObject({ error: "forbidden", permission: "create" });
    const [row] = await world.db.sql`select body, version from notes where id = ${childNote}`;
    expect(row).toEqual({ body: "in", version: 1 });
  });

  it("refuses requests without valid credentials", async () => {
    expect((await call(world.server, null, "GET", `${notesApi}/tree`)).status).toBe(401);
    const forged = { bearer: `hmk_${"A".repeat(43)}` };
    expect((await call(world.server, forged, "GET", `${notesApi}/tree`)).body.error).toBe(
      "unauthenticated",
    );
  });
});

describe("token permissions", () => {
  it("writes with the token's name and refuses what the token lacks", async () => {
    const reader = await apiToken(world, ada, { name: "reader", permissions: ["read"] });
    const denied = await call(world.server, reader.auth, "PATCH", notePath(childNote), {
      expectedVersion: 1,
      body: "agent edit",
    });
    expect(denied.body).toMatchObject({ error: "forbidden", permission: "edit" });
    const writer = await apiToken(world, ada, { name: "claude-laptop", permissions: ["edit"] });
    const edited = await call(world.server, writer.auth, "PATCH", notePath(childNote), {
      expectedVersion: 1,
      body: "agent edit",
      reason: "via token",
    });
    expect(edited.body).toMatchObject({ version: 2 });
    const rows = await revisionRows(world.db, childNote);
    expect(rows.at(-1)).toMatchObject({
      actor_name: "claude-laptop",
      actor_token_id: writer.id,
      actor_user_id: null,
      reason: "via token",
    });
    const [note] = await world.db.sql`select updated_by_name from notes where id = ${childNote}`;
    expect(note?.updated_by_name).toBe("claude-laptop");
  });

  it("never exceeds the owner's role, even after the role changes", async () => {
    const { auth: bob, id: bobId } = await signedIn(world, "bob");
    const token = await apiToken(world, bob, { name: "bob-agent", permissions: ["read", "edit"] });
    await world.db.sql`update users set role = 'guest' where id = ${bobId}`;
    const write = await call(world.server, token.auth, "PATCH", notePath(outsideNote), {
      expectedVersion: 1,
      body: "demoted",
    });
    expect(write.body).toMatchObject({ error: "forbidden", permission: "edit" });
    expect((await call(world.server, token.auth, "GET", notePath(outsideNote))).status).toBe(200);
  });
});

describe("folder scope", () => {
  it("sees the scoped folders and their subfolders only", async () => {
    const scoped = await apiToken(world, ada, {
      name: "scoped",
      permissions: ["read", "search", "create"],
      folderScope: [inside],
    });
    const read = (id: string) => call(world.server, scoped.auth, "GET", notePath(id));
    expect((await read(childNote)).status).toBe(200);
    expect((await read(outsideNote)).body.error).toBe("not_found");
    const tree = await call(world.server, scoped.auth, "GET", `${notesApi}/tree?depth=3`);
    expect(JSON.stringify(tree.body)).not.toContain("Outside");
    expect((tree.body.folders as { path: string }[]).map((folder) => folder.path)).toEqual([
      "Inside",
    ]);
    const search = await call(world.server, scoped.auth, "GET", `${notesApi}/search?q=shared`);
    expect((search.body.hits as { noteId: string }[]).map((hit) => hit.noteId)).toEqual([
      childNote,
    ]);
    const intoChild = await call(world.server, scoped.auth, "POST", `${notesApi}/notes`, {
      folderId: insideChild,
      title: "Agent note",
      body: "",
    });
    expect(intoChild.status).toBe(201);
    const atRoot = await call(world.server, scoped.auth, "POST", `${notesApi}/notes`, {
      title: "Root note",
      body: "",
    });
    expect(atRoot.body).toMatchObject({ error: "forbidden", reason: "outside_scope" });
    const [count] = await world.db
      .sql`select count(*)::int as n from notes where title = 'Root note'`;
    expect(count?.n).toBe(0);
  });
});

describe("revoked and expired tokens", () => {
  it("stops a revoked token at once and an expired one", async () => {
    const token = await apiToken(world, ada, { name: "short-lived", permissions: ["read"] });
    expect((await call(world.server, token.auth, "GET", `${notesApi}/tree`)).status).toBe(200);
    const revoke = await call(world.server, ada, "DELETE", `/api/tokens/v1/tokens/${token.id}`);
    expect(revoke.status).toBe(200);
    const after = await call(world.server, token.auth, "GET", `${notesApi}/tree`);
    expect(after).toMatchObject({ status: 401, body: { error: "token_revoked" } });
    const expiring = await apiToken(world, ada, { name: "expiring", permissions: ["read"] });
    await world.db.sql`
      update api_tokens set created_at = now() - interval '2 hours',
        expires_at = now() - interval '1 hour' where id = ${expiring.id}`;
    const expired = await call(world.server, expiring.auth, "GET", `${notesApi}/tree`);
    expect(expired).toMatchObject({ status: 401, body: { error: "token_expired" } });
  });

  it("records last use at most once a minute", async () => {
    const token = await apiToken(world, ada, { name: "counter", permissions: ["read"] });
    const lastUsed = async () =>
      (await world.db.sql`select last_used_at from api_tokens where id = ${token.id}`)[0]
        ?.last_used_at as Date | null;
    expect(await lastUsed()).toBeNull();
    await call(world.server, token.auth, "GET", `${notesApi}/tree`);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await call(world.server, token.auth, "GET", `${notesApi}/tree`);
    expect((await lastUsed())?.getTime()).toBe(first?.getTime());
    await world.db.sql`
      update api_tokens set last_used_at = now() - interval '2 minutes' where id = ${token.id}`;
    const aged = await lastUsed();
    await call(world.server, token.auth, "GET", `${notesApi}/tree`);
    expect((await lastUsed())?.getTime()).toBeGreaterThan(aged?.getTime() ?? 0);
  });
});
