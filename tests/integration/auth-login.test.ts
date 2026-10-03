import { SESSION_TOKEN_PATTERN } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import {
  login,
  PASSWORD,
  type SeededUser,
  seedUser,
  sessionCount,
  sessionRow,
  sha256Hex,
} from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// POST /api/auth/v1/login. Servers run without SETUP_TOKEN unless a test is
// about it. The attempt counters live in the server process, so tests that
// count failed attempts start their own server.

const DAY = 86_400_000;

let db: TestDatabase;
let ada: SeededUser;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
});

const signedOut = () => newServer(db, { setupToken: null });

describe("success", () => {
  it("returns the user and a session, and stores only the token's digest", async () => {
    const server = await signedOut();
    const before = await sessionCount(db);
    const started = Date.now();
    const response = await login(server, {
      email: "  ADA@Example.com ",
      password: PASSWORD,
      remember: true,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      status: "signed_in",
      user: { id: ada.id, displayName: "ada Display", username: "ada", role: "user", locale: "de" },
      session: {
        token: expect.stringMatching(SESSION_TOKEN_PATTERN),
        expiresAt: expect.any(String),
        remember: true,
      },
    });
    const session = response.body.session as { token: string; expiresAt: string };
    const expires = Date.parse(session.expiresAt) - started;
    expect(expires).toBeGreaterThan(28 * DAY - 10_000);
    expect(expires).toBeLessThan(28 * DAY + 10_000);

    expect(await sessionCount(db)).toBe(before + 1);
    const row = await sessionRow(db, session.token);
    expect(row).toMatchObject({
      user_id: ada.id,
      token_hash: sha256Hex(session.token),
      previous_token_hash: null,
      previous_valid_until: null,
      remember: true,
      revoked_at: null,
      user_agent: "integration-test",
    });
    expect((row.expires_at as Date).toISOString()).toBe(session.expiresAt);
    // The raw token appears nowhere in the table.
    const [{ n }] = (await db.sql`
      select count(*)::int as n from sessions s where s::text like ${`%${session.token}%`}
    `) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  it("stores remember=false and cuts the user agent to 256 characters", async () => {
    const server = await signedOut();
    const response = await login(
      server,
      { email: ada.email, password: PASSWORD, remember: false },
      "x".repeat(300),
    );
    expect(response.status).toBe(200);
    const row = await sessionRow(db, (response.body.session as { token: string }).token);
    expect(row.remember).toBe(false);
    expect(row.user_agent).toHaveLength(256);
  });
});

describe("failures", () => {
  it("answers an unknown e-mail and a wrong password alike, without a session", async () => {
    const server = await signedOut();
    const before = await sessionCount(db);
    const unknown = await login(server, {
      email: "nobody@example.com",
      password: PASSWORD,
      remember: false,
    });
    const wrong = await login(server, {
      email: ada.email,
      password: "wrong password",
      remember: false,
    });
    expect(unknown).toEqual({ status: 401, body: { error: "invalid_credentials" } });
    expect(wrong).toEqual(unknown);
    expect(await sessionCount(db)).toBe(before);
  });

  it("takes about as long for an unknown e-mail as for a wrong password", async () => {
    const server = await signedOut();
    const time = async (email: string) => {
      const started = performance.now();
      const response = await login(server, { email, password: "wrong password", remember: false });
      expect(response.status).toBe(401);
      return performance.now() - started;
    };
    // Warm-up, then alternate so neither side profits from a warmer process.
    await time("nobody@example.com");
    await time(ada.email);
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      unknown.push(await time("nobody@example.com"));
      wrong.push(await time(ada.email));
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] as number;
    const ratio = median(unknown) / median(wrong);
    console.info(
      `login timing: unknown ${unknown.map(Math.round)} ms, wrong ${wrong.map(Math.round)} ms`,
    );
    // Both verify an Argon2id hash (tens of milliseconds); without the dummy
    // hash an unknown e-mail would answer in about a millisecond.
    expect(median(wrong)).toBeGreaterThan(5);
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  });

  it.each([
    ["not JSON", "{", { body: { code: "invalid_body" } }],
    ["a JSON array", [], { body: { code: "invalid_body" } }],
    [
      "nothing",
      {},
      {
        email: { code: "required" },
        password: { code: "required" },
        remember: { code: "required" },
      },
    ],
    [
      "a malformed e-mail",
      { email: "ada", password: "x", remember: false },
      { email: { code: "invalid_email" } },
    ],
    [
      "remember as text",
      { email: "a@example.com", password: "x", remember: "on" },
      { remember: { code: "invalid_type" } },
    ],
  ])("400 with field codes for %s", async (_, body, fields) => {
    const server = await signedOut();
    const response = await fetch(`${server.url}/api/auth/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { error: "validation", fields },
    });
  });

  it("403 while SETUP_TOKEN is set, also with correct credentials", async () => {
    const server = await newServer(db);
    const before = await sessionCount(db);
    expect(await login(server, { email: ada.email, password: PASSWORD, remember: false })).toEqual({
      status: 403,
      body: { error: "setup_token_present" },
    });
    expect(await sessionCount(db)).toBe(before);
  });
});

describe("rate limit (10 failed sign-ins per address)", () => {
  const wrong = () => ({ email: ada.email, password: "wrong password", remember: false });

  it("answers the 11th failed attempt with 429, and correct credentials after it too", async () => {
    const server = await signedOut();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await login(server, wrong())).status).toBe(401);
    }
    expect(await login(server, wrong())).toEqual({ status: 429, body: { error: "rate_limited" } });
    const correct = await login(server, { email: ada.email, password: PASSWORD, remember: false });
    expect(correct).toEqual({ status: 429, body: { error: "rate_limited" } });
  });

  it("counts only failed sign-ins, not invalid input or successful ones", async () => {
    const server = await signedOut();
    for (let round = 1; round <= 11; round += 1) {
      expect((await login(server, { email: "", password: "", remember: false })).status).toBe(400);
      expect(
        (await login(server, { email: ada.email, password: PASSWORD, remember: false })).status,
      ).toBe(200);
    }
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await login(server, wrong())).status).toBe(401);
    }
    expect((await login(server, wrong())).status).toBe(429);
  });

  it("counts requests that run at the same time", async () => {
    const server = await signedOut();
    const responses = await Promise.all(Array.from({ length: 13 }, () => login(server, wrong())));
    const counts = responses.reduce<Record<number, number>>((all, { status }) => {
      all[status] = (all[status] ?? 0) + 1;
      return all;
    }, {});
    expect(counts).toEqual({ 401: 10, 429: 3 });
  });
});
