import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { PASSWORD } from "./auth-harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  signedIn,
} from "./notes-api-harness";
import { tableCounts, trashApi, trashTree } from "./trash-harness";

// Deleting from the trash for good in the audit log: one event per note and
// folder removed (note.deleted_permanently, folder.deleted_permanently),
// sharing a runId, each with the trash batch it was in and its path; emptying
// the trash adds trash.emptied with the counts. Refusals (an API token, no
// recent password) are logged and remove nothing.

let world: NotesWorld;
let ada: Auth;
let adaId: string;
let root: Auth;
let agent: { auth: Auth; id: string; token: string };

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
  ({ auth: root } = await signedIn(world, "root", "admin"));
  agent = await apiToken(world, root, { name: "cleaner", permissions: ["read", "delete"] });
});

afterAll(async () => {
  expect(await expectNoSecrets(world.db, [PASSWORD, agent.token])).toBeGreaterThan(10);
});

const send = (auth: Auth, method: "POST" | "DELETE", path: string, body?: unknown) =>
  call(world.server, auth, method, `${notesApi}${path}`, body);

describe("deleting for good", () => {
  it("logs one event per removed note and folder, with one runId", async () => {
    const tree = await trashTree(world, ada, "P1");
    await send(ada, "DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    const note = await oneEvent(world.db, () => send(ada, "DELETE", `/trash/notes/${tree.plan}`));
    expect(note.event).toMatchObject({
      actor_user_id: adaId,
      source: "web",
      action: "note.deleted_permanently",
      outcome: "success",
      target_kind: "note",
      target_id: tree.plan,
      target_label: "P1/Plan",
      details: { via: "note", runId: expect.any(String), batchId: expect.any(String) },
    });

    const deleted = await send(ada, "DELETE", `/folders/${tree.web}`);
    const { result, events } = await eventsOf(world.db, () =>
      send(ada, "DELETE", `/trash/folders/${tree.web}`),
    );
    expect(result).toMatchObject({ status: 200, body: { notes: 2, folders: 2 } });
    const byTarget = (a: unknown[], b: unknown[]) => String(a[1]).localeCompare(String(b[1]));
    expect(events.map((e) => [e.action, e.target_id, e.target_label]).sort(byTarget)).toEqual(
      [
        ["note.deleted_permanently", tree.spec, "P1/Web/Spec"],
        ["note.deleted_permanently", tree.draft, "P1/Web/Old/Draft"],
        ["folder.deleted_permanently", tree.old, "P1/Web/Old"],
        ["folder.deleted_permanently", tree.web, "P1/Web"],
      ].sort(byTarget),
    );
    const runIds = new Set(events.map((e) => e.details.runId));
    expect(runIds.size).toBe(1);
    for (const event of events) {
      expect(event.details).toMatchObject({ via: "folder", batchId: deleted.body.batchId });
    }
  });

  it("logs emptying the trash per item and once as trash.emptied", async () => {
    const tree = await trashTree(world, root, "P2");
    await send(root, "DELETE", `/folders/${tree.projects}`);
    const { events } = await eventsOf(world.db, () =>
      send(root, "DELETE", trashApi.slice(notesApi.length)),
    );
    const summary = events.filter((e) => e.action === "trash.emptied");
    expect(summary).toEqual([
      expect.objectContaining({
        actor_name: "root",
        outcome: "success",
        details: { runId: expect.any(String), notes: 3, folders: 3 },
      }),
    ]);
    const items = events.filter((e) => e.action !== "trash.emptied");
    expect(items).toHaveLength(6);
    expect(new Set(items.map((e) => e.details.runId))).toEqual(
      new Set([summary[0]?.details.runId]),
    );
    expect(items.every((e) => e.details.via === "empty_trash")).toBe(true);
  });
});

describe("refusals", () => {
  it("logs an API token's attempt and the missing password re-entry, removing nothing", async () => {
    const tree = await trashTree(world, ada, "P3");
    await send(ada, "DELETE", `/notes/${tree.plan}`, { expectedVersion: 1 });
    const before = await tableCounts(world.db);
    const byToken = await oneEvent(world.db, () =>
      send(agent.auth, "DELETE", `/trash/notes/${tree.plan}`),
    );
    expect(byToken.event).toMatchObject({
      actor_token_id: agent.id,
      source: "http",
      action: "note.deleted_permanently",
      outcome: "failure",
      error_code: "forbidden",
      details: { input: { id: tree.plan }, refusal: { reason: "session_required" } },
    });
    const { auth: stale } = await signedIn(world, "stale", "user", false);
    const notRecent = await oneEvent(world.db, () =>
      send(stale, "DELETE", `/trash/notes/${tree.plan}`),
    );
    expect(notRecent.event).toMatchObject({
      actor_name: "stale",
      action: "note.deleted_permanently",
      error_code: "reauthentication_required",
    });
    const notAdmin = await oneEvent(world.db, () => send(ada, "DELETE", "/trash"));
    expect(notAdmin.event).toMatchObject({
      action: "trash.emptied",
      error_code: "forbidden",
      details: { refusal: { reason: "admin_required" } },
    });
    expect(await tableCounts(world.db)).toEqual(before);
  });
});
