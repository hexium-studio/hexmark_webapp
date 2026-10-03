import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { login, PASSWORD, seedUser, sessionCount, sha256Hex } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  addKey,
  call,
  challengeLifetime,
  enableTotp,
  rows,
  setRequireTwoFactor,
  twoFactorServer,
} from "./two-factor-api";

// Forced enrolment: the instance requires a second factor and the account
// has none, so POST /api/auth/v1/login answers "enrolment_required" and the
// session starts only once /api/auth/v1/enrolment/* added a factor.

let db: TestDatabase;
let server: HexmarkServer;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  await setRequireTwoFactor(db, true);
});

async function enrolmentChallenge(email: string, remember: boolean): Promise<string> {
  const response = await login(server, { email, password: PASSWORD, remember });
  expect(response.body).toMatchObject({
    ok: false,
    status: "enrolment_required",
    methods: ["totp", "webauthn"],
  });
  return (response.body.challenge as { token: string }).token;
}

describe("forced enrolment", () => {
  it("issues an enrolment challenge (15 min) and no session", async () => {
    const user = await seedUser(db, "ada");
    const before = await sessionCount(db);
    const token = await enrolmentChallenge(user.email, false);
    expect(await sessionCount(db)).toBe(before);
    const [row] =
      await db.sql`select * from auth_challenges where token_hash = ${sha256Hex(token)}`;
    expect(row).toMatchObject({ purpose: "enrolment", user_id: user.id });
    expect(await challengeLifetime(db, sha256Hex(token))).toBe(15 * 60_000);
  });

  it("starts the session with the authenticator app, carrying remember", async () => {
    const user = await seedUser(db, "bob");
    const token = await enrolmentChallenge(user.email, true);
    const { confirm, recoveryCodes } = await enableTotp(
      server,
      { challenge: token },
      "/auth/v1/enrolment",
    );
    expect(confirm.body).toMatchObject({ ok: true, status: "signed_in", user: { id: user.id } });
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    const session = confirm.body.session as { token: string; remember: boolean };
    expect(session.remember).toBe(true);
    const [row] =
      await db.sql`select user_id, remember from sessions where token_hash = ${sha256Hex(session.token)}`;
    expect(row).toEqual({ user_id: user.id, remember: true });
    // The challenge ended with the enrolment.
    expect(
      await call(server, "POST", "/auth/v1/enrolment/totp/start", { challenge: token }),
    ).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
    // From now on, sign-in asks for the factor.
    const next = await login(server, { email: user.email, password: PASSWORD, remember: false });
    expect(next.body.status).toBe("second_factor_required");
  });

  it("starts the session with a security key", async () => {
    const user = await seedUser(db, "cy");
    const token = await enrolmentChallenge(user.email, false);
    const { verify } = await addKey(server, { challenge: token }, "Key", "/auth/v1/enrolment");
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ status: "signed_in", session: { remember: false } });
    expect(verify.body.credential).toMatchObject({ name: "Key" });
    expect(verify.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it("keeps the challenge while the set-up is unfinished and refuses other uses", async () => {
    const user = await seedUser(db, "dee");
    const token = await enrolmentChallenge(user.email, false);
    const start = await call(server, "POST", "/auth/v1/enrolment/totp/start", { challenge: token });
    expect(start.status).toBe(200);
    const wrong = await call(
      server,
      "POST",
      "/auth/v1/enrolment/totp/confirm",
      { challenge: token },
      {
        code: "000000",
      },
    );
    expect(wrong.body.error).toBe("invalid_code");
    const invalid = { status: 401, body: { error: "challenge_invalid" } };
    expect(
      await call(
        server,
        "POST",
        "/auth/v1/second-factor/totp",
        { challenge: token },
        { code: "123456" },
      ),
    ).toEqual(invalid);
    expect(await call(server, "GET", "/setup/v1/two-factor/status", { challenge: token })).toEqual(
      invalid,
    );
    expect(await call(server, "GET", "/account/v1/security", { challenge: token })).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
    expect(await rows(db, "sessions", user.id)).toHaveLength(0);
  });

  it("is not asked when the instance does not require a factor", async () => {
    const user = await seedUser(db, "eve");
    await setRequireTwoFactor(db, false);
    try {
      const response = await login(server, {
        email: user.email,
        password: PASSWORD,
        remember: false,
      });
      expect(response.body.status).toBe("signed_in");
    } finally {
      await setRequireTwoFactor(db, true);
    }
  });
});
