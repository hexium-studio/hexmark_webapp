import { CHALLENGE_TOKEN_PATTERN } from "@hexmark/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import {
  login,
  PASSWORD,
  type SeededUser,
  seedUser,
  sessionCount,
  sha256Hex,
  signIn,
} from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  awayFromStepEdge,
  call,
  challengeLifetime,
  enableTotp,
  forgetLastTotpStep,
  totp,
  twoFactorServer,
} from "./two-factor-api";

// Signing in with a second factor: POST /api/auth/v1/login answers with a
// challenge, POST /api/auth/v1/second-factor/totp ends it in a session
// (recovery codes: sign-in-recovery.test.ts). Rate limits per address live in the server process, so the
// test that counts them starts its own server.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let secret: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  secret = (await enableTotp(server, { session: await signIn(server, ada.email) })).secret;
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

describe("login with a second factor", () => {
  it("answers with a challenge instead of a session", async () => {
    const before = await sessionCount(db);
    const response = await login(server, { email: ada.email, password: PASSWORD, remember: true });
    expect(response).toEqual({
      status: 200,
      body: {
        ok: false,
        status: "second_factor_required",
        challenge: {
          token: expect.stringMatching(CHALLENGE_TOKEN_PATTERN),
          expiresAt: expect.any(String),
        },
        methods: ["totp", "recovery"],
      },
    });
    expect(await sessionCount(db)).toBe(before);
    const token = (response.body.challenge as { token: string }).token;
    const [row] =
      await db.sql`select * from auth_challenges where token_hash = ${sha256Hex(token)}`;
    expect(row).toMatchObject({
      purpose: "second_factor",
      remember: true,
      attempts: 0,
      used_at: null,
    });
    expect(await challengeLifetime(db, sha256Hex(token))).toBe(5 * 60_000);
  });
});

describe("authenticator app", () => {
  it("starts a session with a current code and carries remember", async () => {
    await forgetLastTotpStep(db, ada.id);
    const token = await challenge(true);
    await awayFromStepEdge();
    const response = await answerTotp(token, totp(secret));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, status: "signed_in", user: { id: ada.id } });
    const session = response.body.session as { token: string; remember: boolean };
    expect(session.remember).toBe(true);
    const [row] =
      await db.sql`select remember from sessions where token_hash = ${sha256Hex(session.token)}`;
    expect(row?.remember).toBe(true);
    expect(await answerTotp(token, totp(secret, 1))).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
  });

  it("refuses a code that was already used (replay) and accepts ±1 step", async () => {
    await forgetLastTotpStep(db, ada.id);
    // The challenge first: a sign-in (password hashing) between computing
    // the previous step's code and sending it could outlast the step.
    const first = await challenge();
    await awayFromStepEdge();
    const code = totp(secret, -1);
    expect((await answerTotp(first, code)).status).toBe(200);
    const replay = await answerTotp(await challenge(), code);
    expect(replay).toEqual({ status: 401, body: { error: "invalid_code", attemptsRemaining: 4 } });
    expect((await answerTotp(await challenge(), totp(secret, 1))).status).toBe(200);
  });

  it("refuses codes two steps away", async () => {
    await forgetLastTotpStep(db, ada.id);
    const token = await challenge();
    await awayFromStepEdge();
    expect((await answerTotp(token, totp(secret, -2))).body).toEqual({
      error: "invalid_code",
      attemptsRemaining: 4,
    });
    // Two steps ahead turns into one step ahead (accepted) if a step ends
    // before the server checks it: away from the edge again, right before.
    await awayFromStepEdge();
    expect((await answerTotp(token, totp(secret, 2))).body).toEqual({
      error: "invalid_code",
      attemptsRemaining: 3,
    });
  });

  it("burns the challenge after 5 wrong codes, even a right one comes too late", async () => {
    await forgetLastTotpStep(db, ada.id);
    const token = await challenge();
    const wrong = totp(secret) === "000000" ? "111111" : "000000";
    const remaining: unknown[] = [];
    for (let i = 0; i < 5; i++)
      remaining.push((await answerTotp(token, wrong)).body.attemptsRemaining);
    expect(remaining).toEqual([4, 3, 2, 1, 0]);
    expect(await answerTotp(token, totp(secret))).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
    const [row] =
      await db.sql`select attempts, used_at from auth_challenges where token_hash = ${sha256Hex(token)}`;
    expect(row?.attempts).toBe(5);
    expect(row?.used_at).toBeInstanceOf(Date);
  });

  it("counts parallel wrong answers without losing any", async () => {
    const token = await challenge();
    const answers = await Promise.all(Array.from({ length: 8 }, () => answerTotp(token, "000001")));
    const statuses = answers.map((answer) => answer.body.error).sort();
    expect(statuses.filter((error) => error === "invalid_code")).toHaveLength(5);
    expect(statuses.filter((error) => error === "challenge_invalid")).toHaveLength(3);
  });

  it("refuses an expired challenge", async () => {
    await forgetLastTotpStep(db, ada.id);
    const token = await challenge();
    await db.sql`update auth_challenges set expires_at = created_at + interval '1 millisecond'
      where token_hash = ${sha256Hex(token)}`;
    expect(await answerTotp(token, totp(secret))).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
  });

  it("refuses requests without or with a malformed challenge, and validates", async () => {
    const invalid = { status: 401, body: { error: "challenge_invalid" } };
    expect(
      await call(server, "POST", "/auth/v1/second-factor/totp", {}, { code: "123456" }),
    ).toEqual(invalid);
    expect(await answerTotp("x".repeat(43), "123456")).toEqual(invalid);
    expect(await answerTotp(await challenge(), "")).toEqual({
      status: 400,
      body: { error: "validation", fields: { code: { code: "required" } } },
    });
  });
});
