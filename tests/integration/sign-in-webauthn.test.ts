import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { authenticate, type SoftCredential } from "../support/soft-authenticator";
import { login, PASSWORD, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase, newServer } from "./harness";
import { migrate } from "./migrations";
import { addKey, call, ORIGIN, rows, twoFactorServer } from "./two-factor-api";

// Signing in with a security key: POST /api/auth/v1/second-factor/webauthn/
// options and /verify, with keys from the software authenticator.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let key: SoftCredential;
let bobsKey: SoftCredential;
let adaSession: string;

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  const setup = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  const bob = await seedUser(db, "bob");
  adaSession = await signIn(setup, ada.email);
  key = (await addKey(setup, { session: adaSession })).key;
  bobsKey = (await addKey(setup, { session: await signIn(setup, bob.email) })).key;
});

beforeEach(async () => {
  server = await twoFactorServer(db);
});

// The test's server is done: its pool would hold connections until the file ends.
afterEach(async () => {
  await server.stop();
});

async function challenge(): Promise<{ token: string; methods: unknown }> {
  const response = await login(server, { email: ada.email, password: PASSWORD, remember: false });
  const issued = response.body.challenge as { token: string };
  return { token: issued.token, methods: response.body.methods };
}

async function options(token: string) {
  const response = await call(server, "POST", "/auth/v1/second-factor/webauthn/options", {
    challenge: token,
  });
  return response.body.options as { challenge: string; rpId: string; allowCredentials: unknown[] };
}

const verify = (token: string, response: unknown) =>
  call(
    server,
    "POST",
    "/auth/v1/second-factor/webauthn/verify",
    { challenge: token },
    { response },
  );

describe("capabilities", () => {
  it("offers security keys with a valid PUBLIC_ORIGIN only", async () => {
    expect(await call(server, "GET", "/instance/v1/capabilities")).toEqual({
      status: 200,
      body: { webauthn: true },
    });
    const plain = await newServer(db, { setupToken: null });
    expect((await call(plain, "GET", "/instance/v1/capabilities")).body).toEqual({
      webauthn: false,
    });
    const insecure = await newServer(db, {
      setupToken: null,
      env: { PUBLIC_ORIGIN: "http://wiki.example.com" },
    });
    expect((await call(insecure, "GET", "/instance/v1/capabilities")).body).toEqual({
      webauthn: false,
    });
    expect(
      await call(plain, "POST", "/account/v1/webauthn/registration/options", {
        session: adaSession,
      }),
    ).toEqual({
      status: 404,
      body: { error: "webauthn_unavailable" },
    });
  });
});

describe("security key at sign-in", () => {
  it("offers the method and the user's keys only", async () => {
    const { token, methods } = await challenge();
    expect(methods).toEqual(["webauthn", "recovery"]);
    const issued = await options(token);
    expect(issued).toMatchObject({ rpId: "localhost", userVerification: "preferred" });
    expect(issued.allowCredentials).toEqual([
      { id: key.id.toString("base64url"), type: "public-key", transports: ["usb"] },
    ]);
  });

  it("starts a session and records counter and last use", async () => {
    const { token } = await challenge();
    const response = await verify(token, authenticate(key, await options(token), ORIGIN));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "signed_in", user: { id: ada.id } });
    const [row] = await rows(db, "webauthn_credentials", ada.id);
    expect(row?.counter).toBe(String(key.counter));
    expect(row?.last_used_at).toBeInstanceOf(Date);
  });

  it("refuses a counter that went backwards", async () => {
    const { token } = await challenge();
    const response = await verify(
      token,
      authenticate(key, await options(token), ORIGIN, { counter: 1 }),
    );
    expect(response).toEqual({
      status: 401,
      body: { error: "webauthn_failed", attemptsRemaining: 4 },
    });
    key.counter = Number((await rows(db, "webauthn_credentials", ada.id))[0]?.counter);
  });

  it("refuses another user's key, another origin and a reused ceremony", async () => {
    const { token } = await challenge();
    const failed = (remaining: number) => ({
      status: 401,
      body: { error: "webauthn_failed", attemptsRemaining: remaining },
    });
    expect(await verify(token, authenticate(bobsKey, await options(token), ORIGIN))).toEqual(
      failed(4),
    );
    const elsewhere = authenticate(key, await options(token), ORIGIN, {
      origin: "http://localhost:4000",
    });
    expect(await verify(token, elsewhere)).toEqual(failed(3));
    const issued = await options(token);
    const first = authenticate(key, issued, ORIGIN);
    const second = authenticate(key, issued, ORIGIN);
    expect((await verify(token, first)).status).toBe(200);
    // The sign-in challenge is used up now, so the second answer is refused
    // before its ceremony is looked at.
    expect(await verify(token, second)).toEqual({
      status: 401,
      body: { error: "challenge_invalid" },
    });
  });

  it("refuses an answer whose ceremony expired", async () => {
    const { token } = await challenge();
    const issued = await options(token);
    await db.sql`update auth_challenges set expires_at = created_at + interval '1 millisecond'
      where webauthn_challenge = ${issued.challenge}`;
    expect((await verify(token, authenticate(key, issued, ORIGIN))).body).toEqual({
      error: "webauthn_failed",
      attemptsRemaining: 4,
    });
  });

  it("is not offered without PUBLIC_ORIGIN", async () => {
    server = await newServer(db, { setupToken: null });
    const { token, methods } = await challenge();
    expect(methods).toEqual(["recovery"]);
    const unavailable = { status: 404, body: { error: "webauthn_unavailable" } };
    expect(
      await call(server, "POST", "/auth/v1/second-factor/webauthn/options", { challenge: token }),
    ).toEqual(unavailable);
    expect(
      await verify(
        token,
        authenticate(key, { challenge: "x".repeat(43), rpId: "localhost" }, ORIGIN),
      ),
    ).toEqual(unavailable);
  });
});
