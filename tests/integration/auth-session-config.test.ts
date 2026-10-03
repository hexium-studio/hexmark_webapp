import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { age, me, type SeededUser, seedUser, sessionRow, signIn } from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";

// Session lifetimes from SESSION_* environment variables, as the server
// process reads them at start-up. Idle time is simulated by moving
// last_seen_at into the past.

let db: TestDatabase;
let ada: SeededUser;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
});

describe("configured lifetimes", () => {
  it("applies SESSION_MAX_AGE and SESSION_IDLE_TIMEOUT from the environment", async () => {
    const short = await newServer(db, {
      setupToken: null,
      env: { SESSION_ROTATION: "1m", SESSION_IDLE_TIMEOUT: "5m", SESSION_MAX_AGE: "1h" },
    });
    const started = Date.now();
    const token = await signIn(short, ada.email);
    const expires = ((await sessionRow(db, token)).expires_at as Date).getTime();
    expect(expires - started).toBeGreaterThan(3_600_000 - 10_000);
    expect(expires - started).toBeLessThan(3_600_000 + 10_000);
    await age(db, token, "last_seen_at", "6 minutes");
    expect((await me(short, token)).status).toBe(401);
    // The same session on a server with the defaults: within its 1 h idle timeout.
    const standard = await newServer(db, { setupToken: null });
    expect((await me(standard, token)).status).toBe(200);
  });

  it("starts with the defaults and logs the problem for an invalid value", async () => {
    const odd = await newServer(db, { setupToken: null, env: { SESSION_MAX_AGE: "forever" } });
    expect(odd.process.tail()).toContain("Configuration error: SESSION_MAX_AGE");
    const started = Date.now();
    const token = await signIn(odd, ada.email);
    const expires = ((await sessionRow(db, token)).expires_at as Date).getTime();
    expect(expires - started).toBeGreaterThan(28 * 86_400_000 - 10_000);
  });
});
