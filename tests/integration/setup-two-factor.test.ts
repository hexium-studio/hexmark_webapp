import { CHALLENGE_TOKEN_PATTERN, RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { login, PASSWORD, sha256Hex } from "./auth-harness";
import { adminInput, newDatabase, newServer, postJson } from "./harness";
import { migrate } from "./migrations";
import { addKey, call, challengeLifetime, enableTotp, ORIGIN } from "./two-factor-api";

// Setup wizard steps 5 and 6: the ticket from create-first-admin, the
// second factor added with it, and PUT /api/setup/v1/system-settings.

let db: TestDatabase;
let server: HexmarkServer;
let ticket: string;
let adminId: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await newServer(db, { env: { PUBLIC_ORIGIN: ORIGIN } });
  const created = await postJson(
    server,
    "/api/setup/v1/create-first-admin",
    adminInput({ password: PASSWORD, passwordConfirm: PASSWORD }),
  );
  expect(created.status).toBe(201);
  ticket = (created.body.ticket as { token: string }).token;
  adminId = (await db.sql`select id from users`)[0]?.id as string;
});

const settings = (body: unknown, token = ticket) =>
  call(server, "PUT", "/setup/v1/system-settings", { challenge: token }, body);

describe("setup enrolment ticket", () => {
  it("is returned by create-first-admin, bound to the admin, valid 15 minutes", async () => {
    expect(ticket).toMatch(CHALLENGE_TOKEN_PATTERN);
    const [row] =
      await db.sql`select * from auth_challenges where token_hash = ${sha256Hex(ticket)}`;
    expect(row).toMatchObject({ purpose: "setup_enrolment", user_id: adminId, used_at: null });
    expect(await challengeLifetime(db, sha256Hex(ticket))).toBe(15 * 60_000);
  });

  it("does not open a session: sign-in stays refused while SETUP_TOKEN is set", async () => {
    const response = await login(server, {
      email: "ada@example.com",
      password: PASSWORD,
      remember: false,
    });
    expect(response).toEqual({ status: 403, body: { error: "setup_token_present" } });
  });

  it("is valid for the setup endpoints only", async () => {
    const invalid = { status: 401, body: { error: "challenge_invalid" } };
    // Sign-in steps are refused as a whole while SETUP_TOKEN is set ...
    const secondFactor = (target: HexmarkServer) =>
      call(
        target,
        "POST",
        "/auth/v1/second-factor/totp",
        { challenge: ticket },
        { code: "123456" },
      );
    expect(await secondFactor(server)).toEqual({
      status: 403,
      body: { error: "setup_token_present" },
    });
    // ... and without it the ticket is no sign-in challenge either.
    expect(await secondFactor(await newServer(db, { setupToken: null }))).toEqual(invalid);
    expect(
      await call(server, "POST", "/auth/v1/enrolment/totp/start", { challenge: ticket }),
    ).toEqual(invalid);
    expect((await call(server, "GET", "/account/v1/security", { challenge: ticket })).status).toBe(
      401,
    );
    expect(await call(server, "GET", "/setup/v1/two-factor/status")).toEqual(invalid);
  });

  it("refuses an expired ticket", async () => {
    const created =
      await db.sql`select created_at from auth_challenges where token_hash = ${sha256Hex(ticket)}`;
    await db.sql`update auth_challenges set expires_at = created_at + interval '1 millisecond'
      where token_hash = ${sha256Hex(ticket)}`;
    try {
      expect(
        await call(server, "GET", "/setup/v1/two-factor/status", { challenge: ticket }),
      ).toEqual({
        status: 401,
        body: { error: "challenge_invalid" },
      });
    } finally {
      await db.sql`update auth_challenges set expires_at = ${created[0]?.created_at as Date}::timestamptz + interval '15 minutes'
        where token_hash = ${sha256Hex(ticket)}`;
    }
  });
});

describe("step 5 and 6", () => {
  it("shows the admin's (empty) factors", async () => {
    expect(await call(server, "GET", "/setup/v1/two-factor/status", { challenge: ticket })).toEqual(
      {
        status: 200,
        body: {
          totp: { enabled: false },
          webauthn: { available: true, credentials: [] },
          recoveryCodes: { remaining: 0 },
          requireTwoFactor: false,
        },
      },
    );
  });

  it("refuses to require two-factor while the admin has none", async () => {
    expect(await settings({ timezone: "Europe/Berlin", requireTwoFactor: true })).toEqual({
      status: 409,
      body: { error: "second_factor_missing" },
    });
    const [row] = await db.sql`select require_two_factor, default_timezone from instance_settings`;
    expect(row).toEqual({ require_two_factor: false, default_timezone: "UTC" });
  });

  it("validates the settings", async () => {
    expect(await settings({ timezone: "Mars/Olympus", requireTwoFactor: "yes" })).toEqual({
      status: 400,
      body: {
        error: "validation",
        fields: {
          timezone: { code: "invalid_option" },
          requireTwoFactor: { code: "invalid_type" },
        },
      },
    });
    expect((await settings({ timezone: "+01:00", requireTwoFactor: false })).status).toBe(400);
  });

  it("adds factors with the ticket, which stays valid", async () => {
    const { recoveryCodes } = await enableTotp(
      server,
      { challenge: ticket },
      "/setup/v1/two-factor",
    );
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    const { verify } = await addKey(
      server,
      { challenge: ticket },
      "Admin key",
      "/setup/v1/two-factor",
    );
    expect(verify.body).toMatchObject({
      ok: true,
      recoveryCodes: null,
      credential: { name: "Admin key" },
    });
    expect(verify.body.session).toBeUndefined();
    const status = await call(server, "GET", "/setup/v1/two-factor/status", { challenge: ticket });
    expect(status.body).toMatchObject({
      totp: { enabled: true },
      recoveryCodes: { remaining: RECOVERY_CODE_COUNT },
    });
  });

  it("saves the settings once the admin has a factor and uses the ticket up", async () => {
    const response = await settings({ timezone: " europe/berlin ", requireTwoFactor: true });
    expect(response).toEqual({ status: 200, body: { ok: true } });
    const [row] = await db.sql`select require_two_factor, default_timezone from instance_settings`;
    expect(row).toEqual({ require_two_factor: true, default_timezone: "Europe/Berlin" });
    const [used] =
      await db.sql`select used_at from auth_challenges where token_hash = ${sha256Hex(ticket)}`;
    expect(used?.used_at).toBeInstanceOf(Date);
    expect(await settings({ timezone: "UTC", requireTwoFactor: false })).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
  });
});
