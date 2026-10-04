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

// PATCH /api/tokens/v1/tokens/:id refused: without a recent password, for
// another user's token, for access that breaks the rules, and for a new
// entry whose target is in the trash (one kept from before may stay there).

const tokensPath = "/api/tokens/v1/tokens";
let world: NotesWorld;
let ada: Auth;
let adaId: string;
const ids = {} as Record<"alpha" | "alphaNote" | "beta" | "betaNote", string>;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
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

describe("changing a token, refused", () => {
  it("refuses without a recent password, for other users and for bad access", async () => {
    const token = await apiToken(world, ada, {
      name: "guarded",
      mode: "deny_list",
      basePermissions: ["read"],
    });
    const { auth: eve } = await signedIn(world, "eve");
    expect((await patch(token.id, { basePermissions: ["edit"] }, eve)).status).toBe(404);
    expect((await patch(token.id, { basePermissions: [] })).body.fields).toEqual({
      basePermissions: { code: "required" },
    });
    expect(
      (
        await patch(token.id, {
          entries: [{ kind: "folder", id: ids.alpha, permissions: ["read"] }],
        })
      ).body.fields,
    ).toEqual({ entries: { code: "invalid", params: { index: 0 } } });
    const failure = await oneEvent(world.db, () =>
      patch(token.id, { mode: "allow_list", entries: [] }),
    );
    expect(failure.event).toMatchObject({
      action: "token.updated",
      outcome: "failure",
      error_code: "validation",
    });
    await world.db.sql`update sessions set reauthenticated_at = null where user_id = ${adaId}`;
    expect((await patch(token.id, { basePermissions: ["edit"] })).body).toEqual({
      error: "reauthentication_required",
    });
    expect(await tokenRow(token.id)).toMatchObject({ base_permissions: ["read"] });
    expect((await patch(token.id, {}, token.auth)).status).toBe(401);
  });

  it("keeps an entry whose target is in the trash, but takes no new one there", async () => {
    // The previous test ended ada's password confirmation: a fresh owner.
    const { auth: owner } = await signedIn(world, "otto");
    const kept = await createFolder(world, owner, "Kept");
    const fresh = await createFolder(world, owner, "Fresh");
    const token = await apiToken(world, owner, {
      name: "trash-aware",
      mode: "allow_list",
      entries: [{ kind: "folder", id: kept, permissions: ["read"] }],
    });
    for (const folder of [kept, fresh]) {
      await call(world.server, owner, "DELETE", `${notesApi}/folders/${folder}`, {});
    }
    const keep = { kind: "folder", id: kept, permissions: ["read", "edit"] };
    expect((await patch(token.id, { entries: [keep] }, owner)).status).toBe(200);
    const added = await patch(
      token.id,
      { entries: [keep, { kind: "folder", id: fresh, permissions: ["read"] }] },
      owner,
    );
    expect(added).toMatchObject({
      status: 404,
      body: { error: "folder_not_found", folderIds: [fresh] },
    });
    expect(await entryRows(token.id)).toEqual([
      {
        target_kind: "folder",
        folder_id: kept,
        note_id: null,
        permissions: ["read", "edit"],
        token_access_mode: "allow_list",
      },
    ]);
  });
});
