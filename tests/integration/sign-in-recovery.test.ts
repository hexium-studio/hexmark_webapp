import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { login, PASSWORD, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { call, enableTotp, twoFactorServer } from "./two-factor-api";

// Signing in with a recovery code (POST /api/auth/v1/second-factor/
// recovery-code), which challenges are accepted where, and the address
// limit on wrong answers.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let codes: string[];

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  codes =
    (await enableTotp(server, { session: await signIn(server, ada.email) })).recoveryCodes ?? [];
});

// A fresh process per test: wrong answers count against the address limit,
// which lives in the server's memory.
beforeEach(async () => {
  server = await twoFactorServer(db);
});

// The test's server is done: its pool would hold connections until the file ends.
afterEach(async () => {
  await server.stop();
});

async function challenge(remember = false): Promise<string> {
  const response = await login(server, { email: ada.email, password: PASSWORD, remember });
  const issued = response.body.challenge as { token: string };
  return issued.token;
}

const answerTotp = (token: string, code: string, target = server) =>
  call(target, "POST", "/auth/v1/second-factor/totp", { challenge: token }, { code });

describe("recovery codes", () => {
  const redeem = (token: string, code: string) =>
    call(server, "POST", "/auth/v1/second-factor/recovery-code", { challenge: token }, { code });

  it("accepts a code in any spelling, once", async () => {
    const [first = ""] = codes;
    const typed = ` ${first.replaceAll("-", "").toLowerCase()} `;
    const response = await redeem(await challenge(), typed);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("signed_in");
    const again = await redeem(await challenge(), first);
    expect(again).toEqual({ status: 401, body: { error: "invalid_code", attemptsRemaining: 4 } });
    const [row] = await db.sql`select count(*)::int as n from recovery_codes
      where user_id = ${ada.id} and used_at is not null`;
    expect(row?.n).toBe(1);
  });

  it("lets only one of two parallel requests redeem the same code", async () => {
    const code = codes[1] ?? "";
    const [a, b] = await Promise.all([
      redeem(await challenge(), code),
      redeem(await challenge(), code),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it("validates the format", async () => {
    expect(await redeem(await challenge(), "ABCD-EFGH-IJK0")).toEqual({
      status: 400,
      body: {
        error: "validation",
        fields: { code: { code: "invalid_format", params: { length: 12 } } },
      },
    });
  });
});

describe("scope and limits", () => {
  it("does not accept a sign-in challenge for enrolment or setup", async () => {
    const token = await challenge();
    const invalid = { status: 401, body: { error: "challenge_invalid" } };
    expect(
      await call(server, "POST", "/auth/v1/enrolment/totp/start", { challenge: token }),
    ).toEqual(invalid);
    expect(
      await call(server, "POST", "/setup/v1/two-factor/totp/start", { challenge: token }),
    ).toEqual(invalid);
    expect(
      await call(server, "POST", "/auth/v1/second-factor/webauthn/options", { challenge: token }),
    ).toEqual({
      status: 409,
      body: { error: "method_unavailable" },
    });
  });

  it("limits wrong answers per address across challenges", async () => {
    const fresh = await twoFactorServer(db);
    const statuses: number[] = [];
    for (let round = 0; round < 3; round++) {
      const response = await login(fresh, {
        email: ada.email,
        password: PASSWORD,
        remember: false,
      });
      const token = (response.body.challenge as { token: string }).token;
      for (let i = 0; i < 4; i++) statuses.push((await answerTotp(token, "000002", fresh)).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
