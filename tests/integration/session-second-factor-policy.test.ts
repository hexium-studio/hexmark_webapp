import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_ENCRYPTION_KEY, TEST_INTERNAL_API_KEY } from "../support/hexmark-server";
import { seedUser } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { setRequireTwoFactor } from "./two-factor-api";
import { count, sealed } from "./two-factor-harness";

// "No session without the second factor" is decided where sessions are
// created, not only by the login endpoint. This calls createSession
// directly, in this process, and checks which rows appear.

let db: TestDatabase;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  // The server's configuration is read when its modules are first imported.
  Object.assign(process.env, {
    POSTGRES_USER: db.server.user,
    POSTGRES_PASSWORD: db.server.password,
    POSTGRES_DB: db.name,
    DB_HOST: db.server.host,
    DB_PORT: String(db.server.port),
    INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
  delete process.env.SETUP_TOKEN;
});

async function create(userId: string, secondFactorVerified: boolean) {
  const { createSession } = await import("../../apps/server/src/services/sessions/sessions");
  return createSession(
    { userId, remember: false, userAgent: null, secondFactorVerified, method: "password" },
    new Date(),
  );
}

describe("createSession", () => {
  it("creates a session from the password alone for an account without factors", async () => {
    const user = await seedUser(db, "ada");
    expect((await create(user.id, false)).status).toBe("created");
    expect(await count(db, "sessions", user.id)).toBe(1);
  });

  it("refuses the password alone once the account has a factor", async () => {
    const user = await seedUser(db, "bob");
    await db.sql`insert into totp_credentials (user_id, secret_encrypted, confirmed_at)
      values (${user.id}, ${sealed()}, now())`;
    expect(await create(user.id, false)).toEqual({ status: "second_factor_required" });
    expect(await count(db, "sessions", user.id)).toBe(0);
    expect((await create(user.id, true)).status).toBe("created");
    expect(await count(db, "sessions", user.id)).toBe(1);
  });

  it("does not count a pending (unconfirmed) authenticator app", async () => {
    const user = await seedUser(db, "cy");
    await db.sql`insert into totp_credentials (user_id, secret_encrypted) values (${user.id}, ${sealed()})`;
    expect((await create(user.id, false)).status).toBe("created");
  });

  it("requires enrolment when the instance requires a factor the account lacks", async () => {
    const user = await seedUser(db, "dee");
    await setRequireTwoFactor(db, true);
    try {
      expect(await create(user.id, false)).toEqual({ status: "enrolment_required" });
      expect(await count(db, "sessions", user.id)).toBe(0);
    } finally {
      await setRequireTwoFactor(db, false);
    }
  });
});
