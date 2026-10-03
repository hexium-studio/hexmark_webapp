import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_SETUP_TOKEN } from "../support/hexmark-server";
import { PASSWORD, seedUser, sessionCount } from "./auth-harness";
import { adminInput, getJson, newDatabase, newServer, postJson } from "./harness";
import { migrate } from "./migrations";

// INTERNAL_API_KEY and ENCRYPTION_KEY (apps/server/src/config/secrets.ts):
// the server starts without them, reports them in the setup status, and
// refuses to create the first admin or a session until both are valid.

const NOT_CONFIGURED = { status: 503, body: { error: "server_not_configured" } };

async function userCount(db: TestDatabase): Promise<number> {
  const [row] = await db.sql`select count(*)::int as n from users`;
  return row?.n as number;
}

describe("setup without valid keys", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await newDatabase();
  });

  it.each([
    ["missing", { INTERNAL_API_KEY: "", ENCRYPTION_KEY: "" }],
    ["invalid", { ENCRYPTION_KEY: "too-short" }],
  ])("keys %s: status says so, token check and admin creation are refused", async (_, env) => {
    const server = await newServer(db, { env });
    const status = await getJson(server, "/api/setup/v1/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ setupOpen: true, secretsConfigured: false });

    const before = await userCount(db);
    expect(
      await postJson(server, "/api/setup/v1/verify-token", { setupToken: TEST_SETUP_TOKEN }),
    ).toEqual(NOT_CONFIGURED);
    expect(await postJson(server, "/api/setup/v1/create-first-admin", adminInput())).toEqual(
      NOT_CONFIGURED,
    );
    expect(await userCount(db)).toBe(before);
    expect(before).toBe(0);
  });

  it("with valid keys the same request creates the admin", async () => {
    const server = await newServer(db);
    expect((await getJson(server, "/api/setup/v1/status")).body).toMatchObject({
      secretsConfigured: true,
    });
    const created = await postJson(server, "/api/setup/v1/create-first-admin", adminInput());
    expect(created.status).toBe(201);
    expect(await userCount(db)).toBe(1);
  });
});

describe("sign-in without valid keys", () => {
  it("is refused with 503 and creates no session; with keys it works", async () => {
    const db = await newDatabase();
    await migrate(db);
    const user = await seedUser(db, "grace");
    const login = { email: user.email, password: PASSWORD, remember: false };

    const broken = await newServer(db, { setupToken: null, env: { INTERNAL_API_KEY: "" } });
    expect(await postJson(broken, "/api/auth/v1/login", login)).toEqual(NOT_CONFIGURED);
    expect(await sessionCount(db)).toBe(0);
    await broken.stop();

    const fixed = await newServer(db, { setupToken: null });
    expect((await postJson(fixed, "/api/auth/v1/login", login)).status).toBe(200);
    expect(await sessionCount(db)).toBe(1);
  });
});
