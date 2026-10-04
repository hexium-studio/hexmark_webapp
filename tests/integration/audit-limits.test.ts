import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { eventsOf, expectNoSecrets } from "./audit-log-harness";
import { login, PASSWORD, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { call, enableTotp, twoFactorServer } from "./two-factor-api";

// Attempts refused by the rate limits, in the audit log: a wrong second
// factor at sign-in and a wrong password re-entered count against the
// address limit; once it is reached, every further attempt is logged with
// rate_limited for the account it was for. Each test starts its own server:
// the limits live in the server's memory.

let db: TestDatabase;
let ada: SeededUser;
let secret = "";

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  ada = await seedUser(db, "ada");
  const server = await twoFactorServer(db);
  secret = (await enableTotp(server, { session: await signIn(server, ada.email) })).secret;
  await server.stop();
});

afterAll(async () => {
  expect(await expectNoSecrets(db, [PASSWORD, secret, "wrong-pass-58aa"])).toBeGreaterThan(10);
});

describe("rate limits", () => {
  it("log second-factor answers refused by the limit, for the challenge's account", async () => {
    const server = await twoFactorServer(db);
    const { events } = await eventsOf(db, async () => {
      for (let round = 0; round < 3; round++) {
        const answer = await login(server, {
          email: ada.email,
          password: PASSWORD,
          remember: false,
        });
        const token = (answer.body.challenge as { token: string }).token;
        for (let i = 0; i < 4; i++) {
          await call(
            server,
            "POST",
            "/auth/v1/second-factor/totp",
            { challenge: token },
            {
              code: "000002",
            },
          );
        }
      }
    });
    const codes = events.map((e) => e.error_code);
    expect(codes).toEqual([...Array(10).fill("invalid_code"), "rate_limited", "rate_limited"]);
    expect(events.every((e) => e.action === "auth.second_factor_verified")).toBe(true);
    expect(events.every((e) => e.actor_user_id === ada.id)).toBe(true);
    await server.stop();
  });

  it("log a password re-entered after the limit as rate_limited", async () => {
    const server = await twoFactorServer(db);
    const bea = await seedUser(db, "bea");
    const session = await signIn(server, bea.email);
    const { events } = await eventsOf(db, async () => {
      for (let i = 0; i < 11; i++) {
        await call(
          server,
          "POST",
          "/auth/v1/reauthenticate",
          { session },
          {
            password: "wrong-pass-58aa",
          },
        );
      }
    });
    expect(events.map((e) => e.error_code)).toEqual([
      ...Array(10).fill("invalid_password"),
      "rate_limited",
    ]);
    expect(events.every((e) => e.action === "auth.reauthenticated")).toBe(true);
    expect(events.every((e) => e.actor_user_id === bea.id)).toBe(true);
    await server.stop();
  });
});
