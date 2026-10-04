import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allEvents, eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { PASSWORD } from "./auth-harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesApi,
  notesWorld,
  revisionRows,
  signedIn,
} from "./notes-api-harness";

// Refused and failed writes in the audit log: the action is rolled back
// (nothing of it is left, no success event), and the failure is written
// afterwards with the error code and a summary of the input - never the
// body. Input refused by an endpoint before any operation runs is logged
// the same way. And the other way round: an action whose event cannot be
// written is rolled back.

let world: NotesWorld;
let ada: Auth;
let adaId: string;
let agent: { auth: Auth; id: string; token: string };

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
  agent = await apiToken(world, ada, { name: "writer", permissions: ["read", "create", "edit"] });
});

afterAll(async () => {
  const secrets = [PASSWORD, agent.token, "edit-marker-55e1"];
  expect(await expectNoSecrets(world.db, secrets)).toBeGreaterThan(3);
});

const send = (auth: Auth, method: "POST" | "PATCH", path: string, body?: unknown) =>
  call(world.server, auth, method, `${notesApi}${path}`, body);

describe("refused writes", () => {
  it("leave nothing but the failure, written after the rollback", async () => {
    const note = await send(ada, "POST", "/notes", { title: "Fixed", body: "v1" });
    const id = note.body.id as string;
    const revisions = await revisionRows(world.db, id);
    const { result, events } = await eventsOf(world.db, () =>
      send(ada, "PATCH", `/notes/${id}`, {
        expectedVersion: 7,
        body: "edit-marker-55e1 never stored",
        reason: "stale",
      }),
    );
    expect(result).toMatchObject({ status: 409, body: { error: "version_conflict" } });
    expect(await revisionRows(world.db, id)).toEqual(revisions);
    expect(events).toEqual([
      expect.objectContaining({
        actor_user_id: adaId,
        source: "web",
        action: "note.updated",
        outcome: "failure",
        error_code: "version_conflict",
        target_kind: null,
        reason: "stale",
        details: {
          input: { note: id, expectedVersion: 7, bodyCharacters: 29 },
          refusal: { currentVersion: 1 },
        },
      }),
    ]);
  });

  it("logs input refused at the endpoint with the field codes", async () => {
    const { event } = await oneEvent(world.db, () =>
      send(agent.auth, "PATCH", `/notes/${agent.id}`, { expectedVersion: "x", body: 5 }),
    );
    expect(event).toMatchObject({
      actor_token_id: agent.id,
      source: "http",
      action: "note.updated",
      outcome: "failure",
      error_code: "validation",
      details: {
        input: { id: agent.id, expectedVersion: "x" },
        refusal: {
          fields: [
            { field: "body", error: "invalid_type" },
            { field: "expectedVersion", error: "invalid_type" },
          ],
        },
      },
    });
  });

  it("roll back the action when its event cannot be written", async () => {
    // A constraint that refuses this one action's events makes the insert
    // in the action's transaction fail: the folder must not exist then.
    await world.db.sql`alter table audit_events add constraint test_block_folder_created
      check (action <> 'folder.created') not valid`;
    try {
      const response = await send(ada, "POST", "/folders", { name: "Never" });
      expect(response).toEqual({ status: 500, body: { error: "internal" } });
      expect(await world.db.sql`select id from folders where name = 'Never'`).toHaveLength(0);
    } finally {
      await world.db.sql`alter table audit_events drop constraint test_block_folder_created`;
    }
    const created = await send(ada, "POST", "/folders", { name: "Never" });
    expect(created.status).toBe(201);
    const events = (await allEvents(world.db)).filter((e) => e.target_label === "Never");
    expect(events.map((e) => [e.action, e.outcome])).toEqual([["folder.created", "success"]]);
  });
});
