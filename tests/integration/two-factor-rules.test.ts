import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { seedLegacyRecoveryCodes } from "../support/legacy-recovery-codes";
import { login, PASSWORD, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  addKey,
  call,
  enableTotp,
  reauthenticate,
  rows,
  setRequireTwoFactor,
  twoFactorServer,
} from "./two-factor-api";
import { count } from "./two-factor-harness";

// Rules that span factors: new recovery codes, the last factor under
// require_two_factor when two removals race, the re-entry rate limit, and
// what deleting a user removes.

let db: TestDatabase;
let server: HexmarkServer;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
});

async function userWithSession(name: string): Promise<{ user: SeededUser; session: string }> {
  const user = await seedUser(db, name);
  return { user, session: await signIn(server, user.email) };
}

describe("account endpoints without a session", () => {
  it.each([
    ["GET", "/account/v1/security"],
    ["POST", "/account/v1/totp/start"],
    ["POST", "/account/v1/totp/confirm"],
    ["DELETE", "/account/v1/totp"],
    ["POST", "/account/v1/webauthn/registration/options"],
    ["POST", "/account/v1/webauthn/registration/verify"],
    ["PATCH", "/account/v1/webauthn/00000000-0000-4000-8000-000000000000"],
    ["DELETE", "/account/v1/webauthn/00000000-0000-4000-8000-000000000000"],
    ["POST", "/account/v1/recovery-codes/regenerate"],
  ] as const)("%s %s answers 401 unauthenticated", async (method, path) => {
    const response = await call(server, method, path, {}, method === "GET" ? undefined : {});
    expect(response).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });
});

describe("regenerating recovery codes", () => {
  it("needs the password re-entered and a factor", async () => {
    const { session } = await userWithSession("ada");
    const regenerate = () =>
      call(server, "POST", "/account/v1/recovery-codes/regenerate", { session });
    expect(await regenerate()).toEqual({
      status: 403,
      body: { error: "reauthentication_required" },
    });
    await reauthenticate(server, session);
    expect(await regenerate()).toEqual({ status: 409, body: { error: "second_factor_missing" } });
  });

  it("replaces every code at once", async () => {
    const { user, session } = await userWithSession("bob");
    await enableTotp(server, { session });
    const before = (await rows(db, "recovery_codes", user.id)).map((row) => row.code_hash);
    await reauthenticate(server, session);
    const response = await call(server, "POST", "/account/v1/recovery-codes/regenerate", {
      session,
    });
    expect(response.status).toBe(200);
    expect(response.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    const after = (await rows(db, "recovery_codes", user.id)).map((row) => row.code_hash);
    expect(after).toHaveLength(RECOVERY_CODE_COUNT);
    expect(after.filter((hash) => before.includes(hash))).toEqual([]);
  });

  // Sets issued before the count went down keep all their codes until they
  // are used or replaced.
  it("keeps a larger set issued earlier usable until it is replaced", async () => {
    const { user, session } = await userWithSession("cleo");
    await enableTotp(server, { session });
    const legacy = await seedLegacyRecoveryCodes(db, user.id, 10);
    expect(legacy.length).toBeGreaterThan(RECOVERY_CODE_COUNT);
    const remaining = async () => {
      const overview = await call(server, "GET", "/account/v1/security", { session });
      return (overview.body.recoveryCodes as { remaining: number }).remaining;
    };
    expect(await remaining()).toBe(10);

    const redeem = async (code: string) => {
      const response = await login(server, {
        email: user.email,
        password: PASSWORD,
        remember: false,
      });
      const challenge = (response.body.challenge as { token: string }).token;
      return call(server, "POST", "/auth/v1/second-factor/recovery-code", { challenge }, { code });
    };
    expect((await redeem(legacy[9] ?? "")).body.status).toBe("signed_in");
    expect(await remaining()).toBe(9);

    await reauthenticate(server, session);
    const response = await call(server, "POST", "/account/v1/recovery-codes/regenerate", {
      session,
    });
    expect(response.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(await remaining()).toBe(RECOVERY_CODE_COUNT);
    expect(await count(db, "recovery_codes", user.id)).toBe(RECOVERY_CODE_COUNT);
    expect((await redeem(legacy[0] ?? "")).body).toMatchObject({ error: "invalid_code" });
  });
});

describe("the last factor", () => {
  // Two tabs remove the user's two factors at the same moment. Each removal
  // alone would be fine; together they would leave none. Several rounds, so
  // the requests really overlap at least once.
  it("survives two removals racing while the instance requires a factor", async () => {
    try {
      for (let round = 0; round < 6; round++) {
        await setRequireTwoFactor(db, false);
        const { user, session } = await userWithSession(`race${round}`);
        const tab = await signIn(server, user.email);
        await enableTotp(server, { session });
        await addKey(server, { session });
        await setRequireTwoFactor(db, true);
        const [key] = await rows(db, "webauthn_credentials", user.id);
        await reauthenticate(server, session);
        await reauthenticate(server, tab);
        const results = await Promise.all([
          call(server, "DELETE", "/account/v1/totp", { session }),
          call(server, "DELETE", `/account/v1/webauthn/${key?.id}`, { session: tab }),
        ]);
        const outcomes = results.map((result) => result.body.error ?? "ok").sort();
        expect(outcomes).toEqual(["last_factor_required", "ok"]);
        const left =
          (await count(db, "totp_credentials", user.id)) +
          (await count(db, "webauthn_credentials", user.id));
        expect(left).toBe(1);
        expect(await count(db, "recovery_codes", user.id)).toBe(RECOVERY_CODE_COUNT);
      }
    } finally {
      await setRequireTwoFactor(db, false);
    }
  });
});

describe("re-entering the password", () => {
  it("shares the sign-in limit for wrong passwords", async () => {
    const fresh = await twoFactorServer(db);
    const user = await seedUser(db, "dee");
    const session = await signIn(fresh, user.email);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await call(
        fresh,
        "POST",
        "/auth/v1/reauthenticate",
        { session },
        { password: "wrong" },
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([...Array(10).fill(403), 429]);
  });

  it("validates and needs a live session", async () => {
    const { session } = await userWithSession("eve");
    expect(await call(server, "POST", "/auth/v1/reauthenticate", { session }, {})).toEqual({
      status: 400,
      body: { error: "validation", fields: { password: { code: "required" } } },
    });
    expect(await call(server, "POST", "/auth/v1/reauthenticate", {}, { password: "x" })).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
  });
});

describe("deleting a user", () => {
  it("removes factors, codes, challenges and sessions with it", async () => {
    const { user, session } = await userWithSession("fay");
    await enableTotp(server, { session });
    await addKey(server, { session });
    await call(server, "POST", "/account/v1/webauthn/registration/options", { session });
    const tables = [
      "totp_credentials",
      "webauthn_credentials",
      "recovery_codes",
      "auth_challenges",
      "sessions",
    ];
    const before = await Promise.all(tables.map((table) => count(db, table, user.id)));
    expect(before).toEqual([1, 1, RECOVERY_CODE_COUNT, 1, 1]);
    await db.sql`delete from users where id = ${user.id}`;
    const after = await Promise.all(tables.map((table) => count(db, table, user.id)));
    expect(after).toEqual([0, 0, 0, 0, 0]);
  });
});
