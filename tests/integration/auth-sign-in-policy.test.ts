import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDatabase } from "../support/databases";
import {
  TEST_ENCRYPTION_KEY,
  TEST_INTERNAL_API_KEY,
  TEST_SETUP_TOKEN,
} from "../support/hexmark-server";
import { seedUser } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";

// "No sign-in while SETUP_TOKEN is set" is decided where sessions are
// created, not only by the login endpoint (which asks first to answer early).
// This calls createSession directly, in this process, with SETUP_TOKEN set
// (and then without the instance keys), and checks that no session row
// appears.

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  userId = (await seedUser(db, "ada")).id;
  // The server's configuration is read when its modules are first imported.
  Object.assign(process.env, {
    POSTGRES_USER: db.server.user,
    POSTGRES_PASSWORD: db.server.password,
    POSTGRES_DB: db.name,
    DB_HOST: db.server.host,
    DB_PORT: String(db.server.port),
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
});

describe("createSession", () => {
  it("refuses while SETUP_TOKEN is set and writes nothing", async () => {
    const { createSession } = await import("../../apps/server/src/services/sessions/sessions");
    const count = async () => (await db.sql`select count(*)::int as n from sessions`)[0]?.n;
    expect(await count()).toBe(0);
    const result = await createSession(
      { userId, remember: true, userAgent: null, secondFactorVerified: false },
      new Date(),
    );
    expect(result).toEqual({ status: "refused", reason: "setup_token_present" });
    expect(await count()).toBe(0);
  });

  it("refuses while a required instance key is missing and writes nothing", async () => {
    vi.resetModules();
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      const { createSession } = await import("../../apps/server/src/services/sessions/sessions");
      const count = async () => (await db.sql`select count(*)::int as n from sessions`)[0]?.n;
      expect(await count()).toBe(0);
      const result = await createSession(
        { userId, remember: true, userAgent: null, secondFactorVerified: false },
        new Date(),
      );
      expect(result).toEqual({ status: "refused", reason: "server_not_configured" });
      expect(await count()).toBe(0);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});
