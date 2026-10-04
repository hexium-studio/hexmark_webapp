import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { eventsOf } from "./audit-log-harness";
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

// An API token entry whose target goes to the trash stays (and applies again
// on restore); when the target is deleted for good - by a person or by the
// purge - the database removes the entry with it, and the server logs each
// removed entry as token.entry_removed by "System".

const DAY = 24 * 60 * 60 * 1000;
let world: NotesWorld;
let ada: Auth;

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada } = await signedIn(world, "ada", "admin"));
  // The purge runs in this process against the same database.
  Object.assign(process.env, {
    POSTGRES_USER: world.db.server.user,
    POSTGRES_PASSWORD: world.db.server.password,
    POSTGRES_DB: world.db.name,
    DB_HOST: world.db.server.host,
    DB_PORT: String(world.db.server.port),
    INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
  delete process.env.SETUP_TOKEN;
});

const entries = (tokenId: string) => world.db.sql`
  select target_kind, folder_id, note_id from api_token_entries where token_id = ${tokenId}
  order by target_kind`;

describe("entries of targets deleted for good", () => {
  it("stay while the target is in the trash and go, logged, when it is deleted for good", async () => {
    const folder = await createFolder(world, ada, "Doomed");
    const note = await createNote(world, ada, { folderId: folder, title: "Inside", body: "x" });
    const allow = await apiToken(world, ada, {
      name: "allow",
      mode: "allow_list",
      entries: [
        { kind: "folder", id: folder, permissions: ["read"] },
        { kind: "note", id: note, permissions: ["edit"] },
      ],
    });
    const deny = await apiToken(world, ada, {
      name: "deny",
      mode: "deny_list",
      basePermissions: ["read"],
      entries: [{ kind: "folder", id: folder }],
    });
    await call(world.server, ada, "DELETE", `${notesApi}/folders/${folder}`, {});
    expect(await entries(allow.id)).toHaveLength(2);
    expect(await entries(deny.id)).toHaveLength(1);
    // Restored, the entry applies again.
    await call(world.server, ada, "POST", `${notesApi}/folders/${folder}/restore`);
    const back = await call(world.server, allow.auth, "GET", `${notesApi}/notes/${note}`);
    expect(back.status).toBe(200);
    await call(world.server, ada, "DELETE", `${notesApi}/folders/${folder}`, {});

    const { events } = await eventsOf(world.db, () =>
      call(world.server, ada, "DELETE", `${notesApi}/trash/folders/${folder}`),
    );
    expect(await entries(allow.id)).toEqual([]);
    expect(await entries(deny.id)).toEqual([]);
    const removed = events.filter((event) => event.action === "token.entry_removed");
    const removal = events.find((event) => event.action === "folder.deleted_permanently");
    expect(removed).toHaveLength(3);
    for (const event of removed) {
      expect(event).toMatchObject({
        actor_kind: "system",
        actor_name: "System",
        source: "system",
        outcome: "success",
        target_kind: "token",
        details: { runId: removal?.details.runId, via: "folder" },
      });
    }
    expect(
      removed
        .map((event) => event.details)
        .sort((a, b) => String(a.entryId).localeCompare(String(b.entryId))),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: "folder",
          targetId: folder,
          targetPath: "Doomed",
          mode: "allow_list",
          permissions: ["read"],
        }),
        expect.objectContaining({
          targetKind: "note",
          targetId: note,
          targetPath: "Doomed/Inside",
          mode: "allow_list",
          permissions: ["edit"],
        }),
        expect.objectContaining({
          targetKind: "folder",
          targetId: folder,
          mode: "deny_list",
          permissions: null,
        }),
      ]),
    );
    expect(removed.map((event) => event.target_label).sort()).toEqual(["allow", "allow", "deny"]);
    // The token itself goes on; the API lists it without the entries.
    const list = await call(world.server, ada, "GET", "/api/tokens/v1/tokens");
    const listed = (list.body.tokens as { id: string; entries: unknown[] }[]).find(
      (t) => t.id === deny.id,
    );
    expect(listed?.entries).toEqual([]);
  });

  it("are logged as removed by the purge, too", async () => {
    const note = await createNote(world, ada, { folderId: null, title: "Old", body: "x" });
    const token = await apiToken(world, ada, {
      name: "purged",
      mode: "allow_list",
      entries: [{ kind: "note", id: note, permissions: ["read"] }],
    });
    await call(world.server, ada, "DELETE", `${notesApi}/notes/${note}`, { expectedVersion: 1 });
    const { purgeExpiredTrash } = await import("../../apps/server/src/services/trash/purge");
    const { result, events } = await eventsOf(world.db, () =>
      purgeExpiredTrash(new Date(Date.now() + 40 * DAY), 28),
    );
    expect(result).toMatchObject({ skipped: false, notes: 1 });
    expect(await entries(token.id)).toEqual([]);
    expect(events.filter((event) => event.action === "token.entry_removed")).toMatchObject([
      {
        actor_name: "System",
        target_id: token.id,
        details: { via: "retention", targetKind: "note", targetId: note, targetPath: "Old" },
      },
    ]);
  });
});
