import { describe, expect, it } from "vitest";
import { freePort } from "../support/processes";
import { getJson, newDatabase, newServer, pgServer } from "./harness";

// GET /health and GET /api/setup/v1/status: what step 1 of the wizard shows.

describe("GET /health", () => {
  it("answers without a database", async () => {
    const server = await newServer(undefined, { setupToken: null, waitForDatabase: false });
    const response = await getJson(server, "/health");
    expect(response).toEqual({ status: 200, body: { status: "ok" } });
  });
});

describe("GET /api/setup/v1/status", () => {
  it("reports an open setup with a valid token once migrated", async () => {
    const server = await newServer(await newDatabase());
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response).toEqual({
      status: 200,
      body: {
        setupOpen: true,
        setupTokenPresent: true,
        setupTokenConfigured: true,
        database: { reachable: true, migrated: true },
      },
    });
  });

  it("accepts a token in lower case with spaces around it", async () => {
    const server = await newServer(await newDatabase(), { setupToken: "  test2345 " });
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response.body).toMatchObject({ setupTokenPresent: true, setupTokenConfigured: true });
  });

  it("reports a missing token", async () => {
    const server = await newServer(await newDatabase(), { setupToken: null });
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ setupTokenPresent: false, setupTokenConfigured: false });
  });

  it.each([
    ["too short", "ABC123"],
    ["too long", "ABCD12345"],
    ["invalid character", "ABCD-123"],
  ])("reports an invalid token (%s)", async (_, token) => {
    const server = await newServer(await newDatabase(), { setupToken: token });
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ setupTokenPresent: true, setupTokenConfigured: false });
  });

  it("answers 503 while the database is not reachable", async () => {
    const pg = pgServer();
    const server = await newServer(undefined, {
      waitForDatabase: false,
      databaseEnv: {
        POSTGRES_USER: pg.user,
        POSTGRES_PASSWORD: pg.password,
        POSTGRES_DB: "postgres",
        DB_HOST: "127.0.0.1",
        // Free right now, so nobody listens there.
        DB_PORT: String(await freePort()),
      },
    });
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response).toEqual({
      status: 503,
      body: {
        error: "database_unavailable",
        database: { reachable: false, migrated: false },
        setupTokenConfigured: true,
      },
    });
  });

  it("answers 503 when the database credentials are not configured", async () => {
    const server = await newServer(undefined, { waitForDatabase: false, setupToken: null });
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ setupTokenConfigured: false });
  });

  it("reports setup closed once a user exists", async () => {
    const db = await newDatabase();
    const server = await newServer(db);
    await db.sql`
      insert into users (email, username, display_name, password_hash, role)
      values ('seed@example.com', 'seed', 'Seed', 'x', 'admin')
    `;
    const response = await getJson(server, "/api/setup/v1/status");
    expect(response.body).toMatchObject({ setupOpen: false });
  });
});
