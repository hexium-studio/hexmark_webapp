import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { newCredential, register } from "../support/soft-authenticator";
import { type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  addKey,
  call,
  ORIGIN,
  reauthenticate,
  rows,
  setRequireTwoFactor,
  twoFactorServer,
} from "./two-factor-api";

// Security keys on the account page (/api/account/v1/webauthn/*) with the
// software authenticator, and GET /api/instance/v1/capabilities.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let session: string;
let otherSession: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  session = await signIn(server, ada.email);
  otherSession = await signIn(server, (await seedUser(db, "bob")).email);
});

const options = (auth = { session }) =>
  call(server, "POST", "/account/v1/webauthn/registration/options", auth);
const verify = (body: unknown, auth = { session }) =>
  call(server, "POST", "/account/v1/webauthn/registration/verify", auth, body);

describe("registration", () => {
  it("issues options for a second factor only", async () => {
    const response = await options();
    expect(response.status).toBe(200);
    const issued = response.body.options as Record<string, unknown>;
    expect(issued).toMatchObject({
      rp: { name: "Hexmark", id: "localhost" },
      user: { name: "ada@example.com", displayName: "ada Display" },
      attestation: "none",
      authenticatorSelection: { residentKey: "discouraged", userVerification: "preferred" },
    });
    const [ceremony] = await db.sql`select * from auth_challenges
      where user_id = ${ada.id} and purpose = 'webauthn_registration'`;
    expect(ceremony?.webauthn_challenge).toBe(issued.challenge);
  });

  it("stores the key and returns recovery codes with the first factor", async () => {
    const { key, verify: response } = await addKey(server, { session }, "  Desk key  ");
    expect(response.status).toBe(200);
    expect(response.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(response.body.credential).toMatchObject({
      name: "Desk key",
      lastUsedAt: null,
      backedUp: false,
    });
    const [row] = await rows(db, "webauthn_credentials", ada.id);
    expect(row).toMatchObject({
      credential_id: key.id.toString("base64url"),
      counter: "0",
      transports: ["usb"],
      name: "Desk key",
      device_type: "singleDevice",
      backed_up: false,
    });
    expect(Buffer.isBuffer(row?.public_key)).toBe(true);
  });

  it("returns no new codes with a further key and excludes registered keys", async () => {
    const issued = (await options()).body.options as { excludeCredentials: unknown[] };
    expect(issued.excludeCredentials).toHaveLength(1);
    const { verify: response } = await addKey(server, { session }, "Spare key");
    expect(response.body.recoveryCodes).toBeNull();
    expect(await rows(db, "webauthn_credentials", ada.id)).toHaveLength(2);
  });

  it("refuses the same key twice", async () => {
    const key = newCredential();
    const first = (await options()).body.options as never;
    expect((await verify({ name: "A", response: register(key, first, ORIGIN) })).status).toBe(200);
    const second = (await options()).body.options as never;
    const response = await verify({ name: "B", response: register(key, second, ORIGIN) });
    expect(response).toEqual({ status: 409, body: { error: "credential_exists" } });
  });

  it("accepts each ceremony once and only from the expected origin", async () => {
    const issued = (await options()).body.options as never;
    const wrongOrigin = register(newCredential(), issued, ORIGIN, {
      origin: "http://localhost:4000",
    });
    const failed = { status: 400, body: { error: "webauthn_registration_failed" } };
    expect(await verify({ name: "X", response: wrongOrigin })).toEqual(failed);
    // The ceremony was used by the failed answer; a correct one is late.
    expect(
      await verify({ name: "X", response: register(newCredential(), issued, ORIGIN) }),
    ).toEqual(failed);
  });

  it("refuses another user's ceremony and an expired one", async () => {
    const bobs = (await options({ session: otherSession })).body.options as never;
    const failed = { status: 400, body: { error: "webauthn_registration_failed" } };
    expect(await verify({ name: "X", response: register(newCredential(), bobs, ORIGIN) })).toEqual(
      failed,
    );
    const issued = (await options()).body.options as { challenge: string };
    await db.sql`update auth_challenges set expires_at = created_at + interval '1 millisecond'
      where webauthn_challenge = ${issued.challenge}`;
    expect(
      await verify({ name: "X", response: register(newCredential(), issued as never, ORIGIN) }),
    ).toEqual(failed);
  });

  it("validates name and response", async () => {
    const response = await verify({ name: "x".repeat(65), response: { id: "a" } });
    expect(response).toEqual({
      status: 400,
      body: {
        error: "validation",
        fields: { name: { code: "too_long", params: { max: 64 } }, response: { code: "required" } },
      },
    });
  });
});

describe("rename and remove", () => {
  const firstKeyId = async () => (await rows(db, "webauthn_credentials", ada.id))[0]?.id as string;

  it("renames the user's own key only", async () => {
    const id = await firstKeyId();
    const renamed = await call(
      server,
      "PATCH",
      `/account/v1/webauthn/${id}`,
      { session },
      { name: "Office" },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.credential).toMatchObject({ id, name: "Office" });
    const notFound = { status: 404, body: { error: "credential_not_found" } };
    const asBob = await call(
      server,
      "PATCH",
      `/account/v1/webauthn/${id}`,
      { session: otherSession },
      { name: "Mine" },
    );
    expect(asBob).toEqual(notFound);
    expect(
      await call(server, "PATCH", "/account/v1/webauthn/not-a-uuid", { session }, { name: "A" }),
    ).toEqual(notFound);
  });

  it("keeps the last factor while the instance requires one", async () => {
    await reauthenticate(server, session);
    const keys = await rows(db, "webauthn_credentials", ada.id);
    for (const key of keys.slice(1)) {
      const removed = await call(server, "DELETE", `/account/v1/webauthn/${key.id}`, { session });
      expect(removed).toEqual({ status: 200, body: { ok: true } });
    }
    await setRequireTwoFactor(db, true);
    const last = await call(server, "DELETE", `/account/v1/webauthn/${keys[0]?.id}`, { session });
    expect(last).toEqual({ status: 409, body: { error: "last_factor_required" } });
    expect(await rows(db, "webauthn_credentials", ada.id)).toHaveLength(1);
    await setRequireTwoFactor(db, false);
    const freed = await call(server, "DELETE", `/account/v1/webauthn/${keys[0]?.id}`, { session });
    expect(freed.status).toBe(200);
    expect(await rows(db, "recovery_codes", ada.id)).toHaveLength(0);
  });
});
