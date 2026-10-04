import { AUDIT_ACTION_CODES } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { humanEvent, insertEvent, systemEvent } from "./audit-harness";
import { allEvents, oneEvent } from "./audit-log-harness";
import {
  type Auth,
  apiToken,
  call,
  createNote,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// GET /api/audit/v1/events and /actions: signed-in people only (a token gets
// 403, and the attempt is logged), administrators see everything, others
// only what they or their tokens did; filters by actor, kind, action (exact
// or prefix), outcome, target and a time range (from inclusive, to
// exclusive); newest first, page by page with a cursor.

let world: NotesWorld;
let root: Auth;
let ada: Auth;
let adaId: string;
let bob: Auth;
let token: { auth: Auth; id: string };

const T = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));
type Page = {
  events: { id: string; actor: { name: string }; action: string; occurredAt: string }[];
  nextCursor: string | null;
};

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: root } = await signedIn(world, "root", "admin"));
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
  ({ auth: bob } = await signedIn(world, "bob"));
  token = await apiToken(world, ada, { name: "ada-agent", permissions: ["read", "create"] });
  await createNote(world, ada, { title: "By ada", body: "a" });
  await createNote(world, token.auth, { title: "By agent", body: "b" });
  await createNote(world, bob, { title: "By bob", body: "c" });
  await call(world.server, bob, "PATCH", `/api/notes/v1/notes/${adaId}`, { expectedVersion: 1 });
  // A fixed timeline, for the range and the cursor.
  for (const minute of [0, 1, 1, 1, 2, 3]) {
    await insertEvent(world.db, systemEvent({ occurred_at: T(minute), action: "audit.purged" }));
  }
  await insertEvent(world.db, humanEvent(adaId, { actor_name: "ada", occurred_at: T(5) }));
});

const query = async (auth: Auth, params = "") =>
  (await call(world.server, auth, "GET", `/api/audit/v1/events${params}`)) as {
    status: number;
    body: Page & Record<string, unknown>;
  };

describe("who may read", () => {
  it("refuses an API token with 403 and logs the attempt", async () => {
    const { result, event } = await oneEvent(world.db, () => query(token.auth));
    expect(result).toEqual({
      status: 403,
      body: { error: "forbidden", reason: "session_required" },
    });
    expect(event).toMatchObject({
      actor_token_id: token.id,
      source: "http",
      action: "audit.read",
      outcome: "failure",
      error_code: "forbidden",
    });
    const actions = await call(world.server, token.auth, "GET", "/api/audit/v1/actions");
    expect(actions.status).toBe(403);
  });

  it("shows an administrator everything and a person only their own and their tokens'", async () => {
    const total = (await allEvents(world.db)).length;
    expect((await query(root, "?limit=200")).body.events).toHaveLength(total);
    const own = (await query(ada, "?limit=200")).body.events;
    expect(own.length).toBeGreaterThan(3);
    expect(new Set(own.map((e) => e.actor.name))).toEqual(new Set(["ada", "ada-agent"]));
    const bobs = (await query(bob, "?limit=200")).body.events;
    expect(new Set(bobs.map((e) => e.actor.name))).toEqual(new Set(["bob"]));
    // Reading the log is not logged.
    expect((await allEvents(world.db)).length).toBe(total);
  });
});

describe("filters", () => {
  const names = async (params: string) =>
    (await query(root, `${params}&limit=200`)).body.events.map(
      (e) => `${e.actor.name}:${e.action}`,
    );

  it("by actor (exact or partial), kind, action (exact or prefix), outcome and target", async () => {
    expect(new Set(await names("?actor=ada"))).toEqual(
      new Set([
        "ada:auth.sign_in",
        "ada:auth.reauthenticated",
        "ada:token.created",
        "ada:note.created",
        "ada:note.updated",
      ]),
    );
    expect(
      new Set((await names("?actor=AD&actorMatch=partial")).map((n) => n.split(":")[0])),
    ).toEqual(new Set(["ada", "ada-agent"]));
    // The token's note, and its refused reads of the log (first describe).
    expect(new Set(await names("?actorKind=agent"))).toEqual(
      new Set(["ada-agent:note.created", "ada-agent:audit.read"]),
    );
    expect(await names("?action=note.created")).toHaveLength(3);
    expect((await names("?action=note.")).every((n) => n.split(":")[1]?.startsWith("note."))).toBe(
      true,
    );
    expect(await names("?action=note.")).toHaveLength(5);
    expect(new Set(await names("?outcome=failure"))).toEqual(
      new Set(["bob:note.updated", "ada-agent:audit.read"]),
    );
    const [note] = await world.db.sql`select id from notes where title = 'By agent'`;
    expect(await names(`?targetKind=note&targetId=${note?.id}`)).toEqual([
      "ada-agent:note.created",
    ]);
  });

  it("by a time range: from inclusive, to exclusive", async () => {
    const page = await query(root, `?from=${T(1).toISOString()}&to=${T(3).toISOString()}`);
    expect(page.body.events.map((e) => e.occurredAt)).toEqual([
      T(2).toISOString(),
      T(1).toISOString(),
      T(1).toISOString(),
      T(1).toISOString(),
    ]);
  });

  it("pages newest first with a cursor, also through equal timestamps", async () => {
    const range = `from=${T(0).toISOString()}&to=${T(4).toISOString()}`;
    const whole = (await query(root, `?${range}&limit=200`)).body.events.map((e) => e.id);
    expect(whole).toHaveLength(6);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const next: Page = (
        await query(root, `?${range}&limit=1${cursor ? `&cursor=${cursor}` : ""}`)
      ).body;
      seen.push(...next.events.map((e) => e.id));
      cursor = next.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(whole);
  });

  it("refuses invalid filters with field codes, and logs them", async () => {
    const bad = await oneEvent(world.db, () => query(ada, "?limit=201&action=Note&cursor=%%%"));
    expect(bad.result).toMatchObject({
      status: 400,
      body: {
        error: "validation",
        fields: { limit: { code: "too_long" }, action: { code: "invalid_format" } },
      },
    });
    expect(bad.event).toMatchObject({
      actor_name: "ada",
      action: "audit.read",
      error_code: "validation",
    });
    const cursor = await query(ada, "?cursor=bm90LWEtY3Vyc29y");
    expect(cursor).toEqual({
      status: 400,
      body: { error: "validation", fields: { cursor: { code: "invalid" } } },
    });
  });
});

describe("the catalogue", () => {
  it("lists every action code with what it means", async () => {
    const response = await call(world.server, ada, "GET", "/api/audit/v1/actions");
    const actions = response.body.actions as { code: string; description: string }[];
    expect(actions.map((a) => a.code)).toEqual(AUDIT_ACTION_CODES);
    expect(actions.every((a) => a.description.length > 10)).toBe(true);
  });
});
