import { beforeAll, describe, expect, it } from "vitest";
import { oneEvent } from "./audit-log-harness";
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

// PATCH /api/tokens/v1/tokens/:id: changing a token's mode, entries, base
// permissions and expiry - with the password re-entered recently, applied to
// the token's very next request, a new mode replacing all entries in one
// transaction, and the audit log recording exactly what changed.

const tokensPath = "/api/tokens/v1/tokens";
let world: NotesWorld;
let ada: Auth;
let _adaId: string;
const ids = {} as Record<"alpha" | "alphaNote" | "beta" | "betaNote", string>;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: _adaId } = await signedIn(world, "ada"));
  ids.alpha = await createFolder(world, ada, "Alpha");
  ids.beta = await createFolder(world, ada, "Beta");
  ids.alphaNote = await createNote(world, ada, { folderId: ids.alpha, title: "A1", body: "a" });
  ids.betaNote = await createNote(world, ada, { folderId: ids.beta, title: "B1", body: "b" });
});

const patch = (id: string, body: unknown, auth: Auth = ada) =>
  call(world.server, auth, "PATCH", `${tokensPath}/${id}`, body);
const entryRows = (tokenId: string) => world.db.sql`
  select target_kind, folder_id, note_id, permissions, token_access_mode
  from api_token_entries where token_id = ${tokenId} order by target_kind, folder_id, note_id`;
const tokenRow = async (tokenId: string) =>
  (
    await world.db.sql`
      select access_mode, base_permissions, expires_at from api_tokens where id = ${tokenId}`
  )[0];

describe("changing a token", () => {
  it("changes entries and permissions, effective at once, with a precise diff", async () => {
    const token = await apiToken(world, ada, {
      name: "editable",
      mode: "allow_list",
      entries: [{ kind: "folder", id: ids.alpha, permissions: ["read"] }],
    });
    const read = (id: string) => call(world.server, token.auth, "GET", `${notesApi}/notes/${id}`);
    expect((await read(ids.alphaNote)).status).toBe(200);
    expect((await read(ids.betaNote)).status).toBe(404);
    expect(await entryRows(token.id)).toEqual([
      {
        target_kind: "folder",
        folder_id: ids.alpha,
        note_id: null,
        permissions: ["read"],
        token_access_mode: "allow_list",
      },
    ]);
    const { result, event } = await oneEvent(world.db, () =>
      patch(token.id, {
        entries: [
          { kind: "folder", id: ids.alpha, permissions: ["read", "edit"] },
          { kind: "note", id: ids.betaNote, permissions: ["read"] },
        ],
      }),
    );
    expect((result as { status: number }).status).toBe(200);
    expect(await entryRows(token.id)).toEqual([
      {
        target_kind: "folder",
        folder_id: ids.alpha,
        note_id: null,
        permissions: ["read", "edit"],
        token_access_mode: "allow_list",
      },
      {
        target_kind: "note",
        folder_id: null,
        note_id: ids.betaNote,
        permissions: ["read"],
        token_access_mode: "allow_list",
      },
    ]);
    expect(event).toMatchObject({
      actor_name: "ada",
      action: "token.updated",
      outcome: "success",
      target_id: token.id,
      details: {
        changed: true,
        addedEntries: [{ kind: "note", id: ids.betaNote, path: "Beta/B1", permissions: ["read"] }],
        changedEntries: [
          {
            kind: "folder",
            id: ids.alpha,
            path: "Alpha",
            before: ["read"],
            after: ["read", "edit"],
          },
        ],
      },
    });
    expect(event.details).not.toHaveProperty("removedEntries");
    expect(event.details).not.toHaveProperty("mode");
    // The very next request has the new access.
    expect((await read(ids.betaNote)).status).toBe(200);
  });

  it("replaces all entries in one go when the mode changes", async () => {
    const token = await apiToken(world, ada, {
      name: "switching",
      mode: "allow_list",
      entries: [{ kind: "folder", id: ids.alpha, permissions: ["read"] }],
    });
    // A new mode needs the new list.
    expect((await patch(token.id, { mode: "deny_list", basePermissions: ["read"] })).body).toEqual({
      error: "validation",
      fields: { entries: { code: "required" } },
    });
    expect(await tokenRow(token.id)).toMatchObject({
      access_mode: "allow_list",
      base_permissions: null,
    });
    const { result, event } = await oneEvent(world.db, () =>
      patch(token.id, {
        mode: "deny_list",
        basePermissions: ["read", "search"],
        entries: [{ kind: "folder", id: ids.alpha }],
      }),
    );
    expect((result as { body: { token: unknown } }).body.token).toMatchObject({
      mode: "deny_list",
      basePermissions: ["read", "search"],
      entries: [{ kind: "folder", targetId: ids.alpha, permissions: null }],
    });
    expect(await tokenRow(token.id)).toMatchObject({
      access_mode: "deny_list",
      base_permissions: ["read", "search"],
    });
    expect(await entryRows(token.id)).toEqual([
      {
        target_kind: "folder",
        folder_id: ids.alpha,
        note_id: null,
        permissions: null,
        token_access_mode: "deny_list",
      },
    ]);
    expect(event.details).toMatchObject({
      mode: { before: "allow_list", after: "deny_list" },
      basePermissions: { before: null, after: ["read", "search"] },
      addedEntries: [{ kind: "folder", id: ids.alpha, permissions: null }],
      removedEntries: [{ kind: "folder", id: ids.alpha, permissions: ["read"] }],
    });
    // Now everything except Alpha.
    const read = (id: string) => call(world.server, token.auth, "GET", `${notesApi}/notes/${id}`);
    expect((await read(ids.alphaNote)).status).toBe(404);
    expect((await read(ids.betaNote)).status).toBe(200);
  });

  it("changes the expiry and the base permissions alone", async () => {
    const token = await apiToken(world, ada, {
      name: "expiring",
      mode: "deny_list",
      basePermissions: ["read"],
    });
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const { event } = await oneEvent(world.db, () =>
      patch(token.id, { expiresAt: until, basePermissions: ["read", "edit"] }),
    );
    expect(event.details).toMatchObject({
      expiresAt: { before: null, after: until },
      basePermissions: { before: ["read"], after: ["read", "edit"] },
    });
    expect(await tokenRow(token.id)).toMatchObject({
      base_permissions: ["read", "edit"],
      expires_at: new Date(until),
    });
    const unchanged = await oneEvent(world.db, () => patch(token.id, {}));
    expect(unchanged.event.details).toMatchObject({ changed: false });
    expect((await patch(token.id, { expiresAt: null })).body.token).toMatchObject({
      expiresAt: null,
    });
  });
});
