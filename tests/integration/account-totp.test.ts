import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  awayFromStepEdge,
  call,
  enableTotp,
  reauthenticate,
  rows,
  totp,
  twoFactorServer,
} from "./two-factor-api";

// The authenticator app on the account page (/api/account/v1/totp/*), the
// security overview and the re-entered password for removing it.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let session: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  session = await signIn(server, ada.email);
});

describe("authenticator app", () => {
  it("starts with an empty overview", async () => {
    const response = await call(server, "GET", "/account/v1/security", { session });
    expect(response).toEqual({
      status: 200,
      body: {
        totp: { enabled: false },
        webauthn: { available: true, credentials: [] },
        recoveryCodes: { remaining: 0 },
        requireTwoFactor: false,
        reauthenticatedUntil: null,
        timezone: "UTC",
      },
    });
  });

  it("shows dates in the account's time zone, else the instance default", async () => {
    const zone = async () =>
      (await call(server, "GET", "/account/v1/security", { session })).body.timezone;
    await db.sql`insert into instance_settings (id, default_locale, default_timezone)
      values (1, 'en', 'Europe/Berlin')
      on conflict (id) do update set default_timezone = 'Europe/Berlin'`;
    expect(await zone()).toBe("Europe/Berlin");
    await db.sql`update users set timezone = 'America/New_York' where id = ${ada.id}`;
    expect(await zone()).toBe("America/New_York");
    await db.sql`update users set timezone = null where id = ${ada.id}`;
    await db.sql`delete from instance_settings`;
    expect(await zone()).toBe("UTC");
  });

  it("refuses to confirm before a set-up was started", async () => {
    const response = await call(
      server,
      "POST",
      "/account/v1/totp/confirm",
      { session },
      {
        code: "123456",
      },
    );
    expect(response).toEqual({ status: 409, body: { error: "totp_not_pending" } });
  });

  it("hands out a secret once and stores it only encrypted", async () => {
    const start = await call(server, "POST", "/account/v1/totp/start", { session });
    expect(start.status).toBe(200);
    const secret = start.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.body.otpauthUri).toBe(
      `otpauth://totp/Hexmark:ada%40example.com?secret=${secret}&issuer=Hexmark&algorithm=SHA1&digits=6&period=30`,
    );
    const [row] = await rows(db, "totp_credentials", ada.id);
    expect(row?.confirmed_at).toBeNull();
    expect(row?.secret_encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(row?.secret_encrypted).not.toContain(secret);
  });

  it("replaces a pending set-up when started again", async () => {
    const first = await call(server, "POST", "/account/v1/totp/start", { session });
    const second = await call(server, "POST", "/account/v1/totp/start", { session });
    expect(second.body.secret).not.toBe(first.body.secret);
    expect(await rows(db, "totp_credentials", ada.id)).toHaveLength(1);
    await awayFromStepEdge();
    const stale = await call(
      server,
      "POST",
      "/account/v1/totp/confirm",
      { session },
      {
        code: totp(first.body.secret as string),
      },
    );
    expect(stale).toEqual({ status: 401, body: { error: "invalid_code" } });
  });

  it("validates the code", async () => {
    const response = await call(
      server,
      "POST",
      "/account/v1/totp/confirm",
      { session },
      {
        code: "12a456",
      },
    );
    expect(response).toEqual({
      status: 400,
      body: {
        error: "validation",
        fields: { code: { code: "invalid_format", params: { length: 6 } } },
      },
    });
  });

  it("confirms with a code and returns a set of recovery codes once", async () => {
    const { recoveryCodes } = await enableTotp(server, { session });
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of recoveryCodes ?? [])
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$/);
    const [row] = await rows(db, "totp_credentials", ada.id);
    expect(row?.confirmed_at).toBeInstanceOf(Date);
    expect(row?.last_used_step).not.toBeNull();
    const stored = await rows(db, "recovery_codes", ada.id);
    expect(stored).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of stored) expect(code.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const plain = (recoveryCodes ?? []).map((code) => code.replaceAll("-", ""));
    expect(stored.some((row) => plain.includes(row.code_hash as string))).toBe(false);
  });

  it("refuses a second set-up while one is active", async () => {
    const start = await call(server, "POST", "/account/v1/totp/start", { session });
    expect(start).toEqual({ status: 409, body: { error: "totp_already_enabled" } });
    const confirm = await call(
      server,
      "POST",
      "/account/v1/totp/confirm",
      { session },
      {
        code: "123456",
      },
    );
    expect(confirm).toEqual({ status: 409, body: { error: "totp_already_enabled" } });
  });

  it("shows the factor in the overview", async () => {
    const response = await call(server, "GET", "/account/v1/security", { session });
    expect(response.body).toMatchObject({
      totp: { enabled: true },
      recoveryCodes: { remaining: RECOVERY_CODE_COUNT },
    });
  });
});

describe("removing it needs the password re-entered", () => {
  it("refuses without re-entry and keeps the factor", async () => {
    const response = await call(server, "DELETE", "/account/v1/totp", { session });
    expect(response).toEqual({ status: 403, body: { error: "reauthentication_required" } });
    expect(await rows(db, "totp_credentials", ada.id)).toHaveLength(1);
  });

  it("refuses a wrong password at re-entry", async () => {
    const response = await call(
      server,
      "POST",
      "/auth/v1/reauthenticate",
      { session },
      {
        password: "wrong password",
      },
    );
    expect(response).toEqual({ status: 403, body: { error: "invalid_password" } });
  });

  it("refuses when the re-entry is older than 10 minutes", async () => {
    await reauthenticate(server, session);
    await db.sql`update sessions set reauthenticated_at = now() - interval '10 minutes 5 seconds'
      where user_id = ${ada.id}`;
    const response = await call(server, "DELETE", "/account/v1/totp", { session });
    expect(response).toEqual({ status: 403, body: { error: "reauthentication_required" } });
  });

  it("removes it within 10 minutes, and the recovery codes with the last factor", async () => {
    await reauthenticate(server, session);
    const overview = await call(server, "GET", "/account/v1/security", { session });
    const until = Date.parse(overview.body.reauthenticatedUntil as string) - Date.now();
    expect(until).toBeGreaterThan(9 * 60_000);
    expect(until).toBeLessThanOrEqual(10 * 60_000);
    const response = await call(server, "DELETE", "/account/v1/totp", { session });
    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(await rows(db, "totp_credentials", ada.id)).toHaveLength(0);
    expect(await rows(db, "recovery_codes", ada.id)).toHaveLength(0);
    const again = await call(server, "DELETE", "/account/v1/totp", { session });
    expect(again).toEqual({ status: 404, body: { error: "totp_not_enabled" } });
  });

  it("refuses a revoked session at once", async () => {
    const other = await signIn(server, ada.email);
    await call(server, "POST", "/auth/v1/logout", { session: other });
    const response = await call(server, "POST", "/account/v1/totp/start", { session: other });
    expect(response).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });
});
