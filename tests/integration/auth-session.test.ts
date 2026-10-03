import { SESSION_TOKEN_PATTERN } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import {
  age,
  logout,
  me,
  type SeededUser,
  seedUser,
  sessionRow,
  sha256Hex,
  signIn,
} from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// GET /api/auth/v1/me and POST /api/auth/v1/logout. Time-based rules are
// tested by moving the session's timestamps into the past in the database
// (the server compares them with its own clock), so nothing here waits.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
  server = await newServer(db, { setupToken: null });
});

const USER = {
  id: expect.any(String),
  displayName: "ada Display",
  username: "ada",
  role: "user",
  locale: "de",
};

describe("me", () => {
  it("returns the user and the session for a fresh token, without a new token", async () => {
    const token = await signIn(server, ada.email);
    const response = await me(server, token);
    expect(response).toEqual({
      status: 200,
      body: {
        user: { ...USER, id: ada.id },
        session: { expiresAt: expect.any(String), remember: false },
      },
    });
  });

  it.each([
    ["no header", {}],
    ["another scheme", { authorization: "Bearer abc" }],
    ["a malformed token", { authorization: "Session not-a-token" }],
    ["an unknown token", { authorization: `Session ${"A".repeat(43)}` }],
  ])("401 for %s", async (_, headers) => {
    const response = await fetch(`${server.url}/api/auth/v1/me`, { headers });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
  });

  it("without remember me: 401 after the idle timeout, 200 just before it (and records the use)", async () => {
    const token = await signIn(server, ada.email);
    await age(db, token, "last_seen_at", "59 minutes");
    const before = await sessionRow(db, token);
    expect((await me(server, token)).status).toBe(200);
    const after = await sessionRow(db, token);
    expect((after.last_seen_at as Date).getTime()).toBeGreaterThan(
      (before.last_seen_at as Date).getTime() + 58 * 60_000,
    );
    await age(db, token, "last_seen_at", "61 minutes");
    expect(await me(server, token)).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });

  it("with remember me: no idle timeout", async () => {
    const token = await signIn(server, ada.email, true);
    await age(db, token, "last_seen_at", "3 days");
    const response = await me(server, token);
    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({ remember: true });
  });

  it("401 once the maximum age has passed, also with remember me", async () => {
    const token = await signIn(server, ada.email, true);
    await age(db, token, "created_at", "29 days");
    await age(db, token, "expires_at", "1 second");
    expect(await me(server, token)).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });

  it("401 for a revoked session", async () => {
    const token = await signIn(server, ada.email, true);
    await age(db, token, "revoked_at", "0 seconds");
    expect(await me(server, token)).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });
});

describe("rotation", () => {
  it("issues a new token once due; the old one works only during the grace period", async () => {
    const old = await signIn(server, ada.email);
    await age(db, old, "rotated_at", "6 minutes");
    const before = await sessionRow(db, old);

    const rotated = await me(server, old);
    expect(rotated.status).toBe(200);
    const fresh = (rotated.body.session as { rotatedToken?: string }).rotatedToken as string;
    expect(fresh).toMatch(SESSION_TOKEN_PATTERN);
    expect(fresh).not.toBe(old);

    const after = await sessionRow(db, fresh);
    expect(after).toMatchObject({
      id: before.id,
      token_hash: sha256Hex(fresh),
      previous_token_hash: sha256Hex(old),
      expires_at: before.expires_at,
    });
    const grace =
      (after.previous_valid_until as Date).getTime() - (after.rotated_at as Date).getTime();
    expect(grace).toBe(30_000);

    // Within the grace period both work, and neither rotates again.
    for (const token of [old, fresh]) {
      const response = await me(server, token);
      expect(response.status).toBe(200);
      expect(response.body.session).not.toHaveProperty("rotatedToken");
    }
    await db.sql`
      update sessions set previous_valid_until = now() - interval '1 second'
      where token_hash = ${sha256Hex(fresh)}
    `;
    expect((await me(server, old)).status).toBe(401);
    expect((await me(server, fresh)).status).toBe(200);
  });

  it("rotates once when several requests with the same token arrive together", async () => {
    const old = await signIn(server, ada.email);
    await age(db, old, "rotated_at", "6 minutes");
    // The test holds the row lock while the requests arrive, so they all
    // reach the database before any of them can rotate. Without the
    // server's own lock each would decide to rotate on what it read.
    let pending: Promise<Awaited<ReturnType<typeof me>>[]> | undefined;
    await db.sql.begin(async (tx) => {
      await tx`select id from sessions where token_hash = ${sha256Hex(old)} for update`;
      pending = Promise.all(Array.from({ length: 6 }, () => me(server, old)));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const responses = await (pending as NonNullable<typeof pending>);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const issued = responses
      .map((r) => (r.body.session as { rotatedToken?: string }).rotatedToken)
      .filter(Boolean);
    expect(issued).toHaveLength(1);
    expect((await sessionRow(db, old)).token_hash).toBe(sha256Hex(issued[0] as string));
  });
});

describe("logout", () => {
  it("revokes the session; other sessions of the user keep working", async () => {
    const token = await signIn(server, ada.email);
    const other = await signIn(server, ada.email);
    expect((await sessionRow(db, token)).revoked_at).toBeNull();

    expect(await logout(server, token)).toEqual({ status: 200, body: { ok: true } });
    expect((await sessionRow(db, token)).revoked_at).toBeInstanceOf(Date);
    expect((await me(server, token)).status).toBe(401);
    expect(await logout(server, token)).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
    expect((await me(server, other)).status).toBe(200);
  });

  it("401 without a token", async () => {
    const response = await fetch(`${server.url}/api/auth/v1/logout`, { method: "POST" });
    expect(response.status).toBe(401);
  });
});

describe("deleting a user", () => {
  it("removes the user's sessions", async () => {
    const bob = await seedUser(db, "bob");
    const tokens = [await signIn(server, bob.email), await signIn(server, bob.email, true)];
    const count = async () =>
      (await db.sql`select count(*)::int as n from sessions where user_id = ${bob.id}`)[0]
        ?.n as number;
    expect(await count()).toBe(2);
    await db.sql`delete from users where id = ${bob.id}`;
    expect(await count()).toBe(0);
    for (const token of tokens) expect((await me(server, token)).status).toBe(401);
    // Ada's sessions are untouched.
    expect(
      (await db.sql`select count(*)::int as n from sessions where user_id = ${ada.id}`)[0]?.n,
    ).toBeGreaterThan(0);
  });
});
