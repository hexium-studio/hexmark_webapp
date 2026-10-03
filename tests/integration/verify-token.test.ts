import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_SETUP_TOKEN } from "../support/hexmark-server";
import { adminInput, newDatabase, newServer, postJson } from "./harness";

// POST /api/setup/v1/verify-token. The attempt counters live in the server
// process, so every test that counts attempts starts its own server.

const PATH = "/api/setup/v1/verify-token";
const WRONG = "WRONG234";

let db: TestDatabase;

beforeAll(async () => {
  db = await newDatabase();
});

describe("answers", () => {
  it("200 for the configured token", async () => {
    const server = await newServer(db);
    expect(await postJson(server, PATH, { setupToken: TEST_SETUP_TOKEN })).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it("200 for the token in lower case with spaces around it", async () => {
    const server = await newServer(db);
    const response = await postJson(server, PATH, {
      setupToken: `  ${TEST_SETUP_TOKEN.toLowerCase()} `,
    });
    expect(response.status).toBe(200);
  });

  it("401 for a wrong token", async () => {
    const server = await newServer(db);
    expect(await postJson(server, PATH, { setupToken: WRONG })).toEqual({
      status: 401,
      body: { error: "invalid_token" },
    });
  });

  it.each([
    ["not JSON", "{", { body: { code: "invalid_body" } }],
    ["a JSON array", "[]", { body: { code: "invalid_body" } }],
    ["no token", {}, { setupToken: { code: "required" } }],
    ["a number", { setupToken: 12345678 }, { setupToken: { code: "invalid_type" } }],
    [
      "7 characters",
      { setupToken: "ABC1234" },
      { setupToken: { code: "invalid_format", params: { length: 8 } } },
    ],
    [
      "a dash",
      { setupToken: "ABCD-123" },
      { setupToken: { code: "invalid_format", params: { length: 8 } } },
    ],
  ])("400 with field codes for %s", async (_, body, fields) => {
    const server = await newServer(db);
    expect(await postJson(server, PATH, body)).toEqual({
      status: 400,
      body: { error: "validation", fields },
    });
  });

  it("413 for a body above the size limit", async () => {
    const server = await newServer(db);
    const response = await postJson(server, PATH, { setupToken: "A".repeat(20_000) });
    expect(response).toEqual({ status: 413, body: { error: "payload_too_large" } });
  });

  it("503 when SETUP_TOKEN is not configured", async () => {
    const server = await newServer(db, { setupToken: null });
    expect(await postJson(server, PATH, { setupToken: TEST_SETUP_TOKEN })).toEqual({
      status: 503,
      body: { error: "setup_token_not_configured" },
    });
  });
});

describe("rate limit (5 failed attempts per address)", () => {
  it("answers the 6th failed attempt with 429, and the correct token after it too", async () => {
    const server = await newServer(db);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await postJson(server, PATH, { setupToken: WRONG })).status).toBe(401);
    }
    expect(await postJson(server, PATH, { setupToken: WRONG })).toEqual({
      status: 429,
      body: { error: "rate_limited" },
    });
    expect((await postJson(server, PATH, { setupToken: TEST_SETUP_TOKEN })).status).toBe(429);
    // The limit is shared with creating the admin.
    const create = await postJson(server, "/api/setup/v1/create-first-admin", adminInput());
    expect(create.status).toBe(429);
  });

  it("counts only wrong tokens, not invalid input or correct tokens", async () => {
    const server = await newServer(db);
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      expect((await postJson(server, PATH, { setupToken: "short" })).status).toBe(400);
      expect((await postJson(server, PATH, { setupToken: TEST_SETUP_TOKEN })).status).toBe(200);
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await postJson(server, PATH, { setupToken: WRONG })).status).toBe(401);
    }
    expect((await postJson(server, PATH, { setupToken: WRONG })).status).toBe(429);
  });

  it("counts requests that run at the same time", async () => {
    const server = await newServer(db);
    const statuses = await Promise.all(
      Array.from({ length: 8 }, () => postJson(server, PATH, { setupToken: WRONG })),
    );
    const counts = statuses.reduce<Record<number, number>>((all, { status }) => {
      all[status] = (all[status] ?? 0) + 1;
      return all;
    }, {});
    expect(counts).toEqual({ 401: 5, 429: 3 });
  });
});

describe("after setup", () => {
  it("answers 404 once a user exists", async () => {
    const closed = await newDatabase();
    const server = await newServer(closed);
    await closed.sql`
      insert into users (email, username, display_name, password_hash, role)
      values ('seed@example.com', 'seed', 'Seed', 'x', 'admin')
    `;
    expect(await postJson(server, PATH, { setupToken: TEST_SETUP_TOKEN })).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
  });
});
