import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectNoSecrets, oneEvent } from "./audit-log-harness";
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

// The audit log for note writes over /api/notes/v1 (services/notes): every
// successful write is exactly one event in the write's transaction, with
// the actor (username or token name), the source (web for a session, http
// for a token), the note as target and the reason. Refused writes:
// audit-refusals.test.ts.

let world: NotesWorld;
let ada: Auth;
let adaId: string;
let agent: { auth: Auth; id: string; token: string };

// Bodies carry markers the log must never contain.
const SECRET_BODY = "body-marker-7f3a1c intro\n\n# Steps\nstep-marker-2b9d\n";
const secrets = new Set([PASSWORD, "body-marker-7f3a1c", "step-marker-2b9d", "edit-marker-55e1"]);

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
  agent = await apiToken(world, ada, {
    name: "writer",
    permissions: ["read", "search", "create", "edit", "move", "delete"],
  });
  secrets.add(agent.token);
});

afterAll(async () => {
  expect(await expectNoSecrets(world.db, secrets)).toBeGreaterThan(10);
});

const send = (
  auth: Auth,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => call(world.server, auth, method, `${notesApi}${path}`, body);

const asAda = { actor_kind: "human", actor_user_id: null as string | null, actor_name: "ada" };

describe("a person's note writes", () => {
  it("logs each write once, with the username, source web, the note and the reason", async () => {
    const created = await oneEvent(world.db, () =>
      send(ada, "POST", "/notes", { title: "Plan", body: SECRET_BODY, reason: "start" }),
    );
    const id = (created.result as { body: { id: string } }).body.id;
    expect(created.event).toMatchObject({
      ...asAda,
      actor_user_id: adaId,
      actor_token_id: null,
      source: "web",
      action: "note.created",
      outcome: "success",
      error_code: null,
      target_kind: "note",
      target_id: id,
      target_label: "Plan",
      reason: "start",
      details: { version: 1, bodyCharacters: Array.from(SECRET_BODY).length },
    });

    const edited = await oneEvent(world.db, () =>
      send(ada, "PATCH", `/notes/${id}`, {
        expectedVersion: 1,
        body: `${SECRET_BODY}edit-marker-55e1\n`,
        reason: "more",
      }),
    );
    expect(edited.event).toMatchObject({
      action: "note.updated",
      reason: "more",
      details: { changed: true, change: "edited", version: 2, previousVersion: 1 },
    });

    const renamed = await oneEvent(world.db, () =>
      send(ada, "PATCH", `/notes/${id}`, { expectedVersion: 2, title: "Plan B" }),
    );
    expect(renamed.event).toMatchObject({
      action: "note.updated",
      target_label: "Plan B",
      details: { change: "renamed", previousTitle: "Plan", title: "Plan B", previousPath: "Plan" },
    });

    const unchanged = await oneEvent(world.db, () =>
      send(ada, "PATCH", `/notes/${id}`, { expectedVersion: 3, title: "Plan B", reason: "x" }),
    );
    expect(unchanged.event).toMatchObject({
      action: "note.updated",
      outcome: "success",
      reason: null,
      details: { changed: false, version: 3 },
    });

    const section = await oneEvent(world.db, () =>
      send(ada, "PUT", `/notes/${id}/sections`, {
        expectedVersion: 3,
        heading: "Steps",
        body: "# Steps\nnew steps\n",
      }),
    );
    expect(section.event).toMatchObject({
      action: "note.section_replaced",
      details: { sectionPath: "Steps", version: 4, previousVersion: 3 },
    });
  });

  it("logs moving, deleting and restoring with paths and the trash batch", async () => {
    const folder = await send(ada, "POST", "/folders", { name: "Box" });
    const note = await send(ada, "POST", "/notes", { title: "Mover", body: "x" });
    const id = note.body.id as string;
    const moved = await oneEvent(world.db, () =>
      send(ada, "POST", `/notes/${id}/move`, { expectedVersion: 1, folderId: folder.body.id }),
    );
    expect(moved.event).toMatchObject({
      action: "note.moved",
      target_label: "Box/Mover",
      details: { previousPath: "Mover", version: 2 },
    });
    const deleted = await oneEvent(world.db, () =>
      send(ada, "DELETE", `/notes/${id}`, { expectedVersion: 2, reason: "gone" }),
    );
    const batchId = (deleted.result as { body: { batchId: string } }).body.batchId;
    expect(deleted.event).toMatchObject({
      action: "note.deleted",
      reason: "gone",
      details: { batchId, change: "deleted" },
    });
    const restored = await oneEvent(world.db, () =>
      send(ada, "POST", `/notes/${id}/restore`, { reason: "back" }),
    );
    expect(restored.event).toMatchObject({
      action: "note.restored",
      target_label: "Box/Mover",
      reason: "back",
      details: { batchId, change: "restored", version: 4 },
    });
  });
});

describe("an agent's note writes over HTTP", () => {
  it("are logged with the token's name and source http", async () => {
    const { event } = await oneEvent(world.db, () =>
      send(agent.auth, "POST", "/notes", { title: "By agent", body: "a" }),
    );
    expect(event).toMatchObject({
      actor_kind: "agent",
      actor_user_id: null,
      actor_token_id: agent.id,
      actor_name: "writer",
      source: "http",
      action: "note.created",
    });
  });
});
