import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { login, logout, me, PASSWORD, signIn } from "./auth-harness";
import { newServer } from "./harness";
import {
  type Auth,
  apiToken,
  call,
  type NotesWorld,
  notesWorld,
  signedIn,
} from "./notes-api-harness";

// Signing in and out, re-entering the password and API tokens in the audit
// log. Failed sign-ins are auth.sign_in_failed: for a known account with
// its username, for an unknown e-mail as "unknown" - the e-mail itself is
// never logged. A session that simply expires is not logged.

let world: NotesWorld;
let ada: Auth;
let adaId: string;
const secrets = new Set([PASSWORD, "wrong-password-71c2", "nobody@example.com"]);

beforeAll(async () => {
  world = await notesWorld();
  ({ auth: ada, id: adaId } = await signedIn(world, "ada"));
});

afterAll(async () => {
  expect(await expectNoSecrets(world.db, secrets)).toBeGreaterThan(10);
  // Also no e-mail of a known account.
  expect(await expectNoSecrets(world.db, ["ada@example.com", "bea@example.com"])).toBeGreaterThan(
    0,
  );
});

const tryLogin = (email: string, password: string) =>
  login(world.server, { email, password, remember: true });

describe("signing in and out", () => {
  it("logs a sign-in with the method, and a sign-out", async () => {
    const { result, event } = await oneEvent(world.db, () => tryLogin("ada@example.com", PASSWORD));
    const token = (result as { body: { session: { token: string } } }).body.session.token;
    secrets.add(token);
    expect(event).toMatchObject({
      actor_kind: "human",
      actor_user_id: adaId,
      actor_name: "ada",
      source: "web",
      action: "auth.sign_in",
      outcome: "success",
      target_kind: "user",
      target_id: adaId,
      details: { method: "password", remember: true },
    });
    const out = await oneEvent(world.db, () => logout(world.server, token));
    expect(out.event).toMatchObject({ action: "auth.sign_out", actor_user_id: adaId });
  });

  it("logs a wrong password for the account and an unknown e-mail as unknown", async () => {
    const wrong = await oneEvent(world.db, () =>
      tryLogin("ada@example.com", "wrong-password-71c2"),
    );
    expect(wrong.event).toMatchObject({
      actor_kind: "human",
      actor_user_id: adaId,
      actor_name: "ada",
      action: "auth.sign_in_failed",
      outcome: "failure",
      error_code: "invalid_credentials",
      details: {},
    });
    const unknown = await oneEvent(world.db, () => tryLogin("nobody@example.com", PASSWORD));
    expect(unknown.event).toMatchObject({
      actor_kind: "human",
      actor_user_id: null,
      actor_token_id: null,
      actor_name: "unknown",
      action: "auth.sign_in_failed",
      error_code: "invalid_credentials",
      target_kind: null,
      details: {},
    });
  });

  it("logs attempts refused by the rate limit, for the account they name", async () => {
    const server = await newServer(world.db, { setupToken: null });
    for (let attempt = 0; attempt < 10; attempt++) {
      await login(server, { email: "nobody@example.com", password: "x", remember: false });
    }
    const { result, event } = await oneEvent(world.db, () =>
      login(server, { email: "ada@example.com", password: PASSWORD, remember: false }),
    );
    expect(result).toMatchObject({ status: 429 });
    expect(event).toMatchObject({
      actor_user_id: adaId,
      action: "auth.sign_in_failed",
      error_code: "rate_limited",
    });
  });

  it("does not log a session that expires", async () => {
    const token = await signIn(world.server, "ada@example.com");
    // Idle for longer than the timeout of a sign-in without "remember me".
    await world.db.sql`update sessions set last_seen_at = now() - interval '61 minutes'
      where user_id = ${adaId} and revoked_at is null and remember = false`;
    const { result, events } = await eventsOf(world.db, () => me(world.server, token));
    expect((result as { status: number }).status).toBe(401);
    expect(events).toEqual([]);
  });
});

describe("re-entering the password", () => {
  it("logs success and a wrong password, never the password", async () => {
    ({ auth: ada } = await signedIn(world, "bea", "user", false));
    const reauth = (password: unknown) =>
      call(world.server, ada, "POST", "/api/auth/v1/reauthenticate", { password });
    const right = await oneEvent(world.db, () => reauth(PASSWORD));
    expect(right.event).toMatchObject({
      actor_name: "bea",
      action: "auth.reauthenticated",
      outcome: "success",
    });
    const wrong = await oneEvent(world.db, () => reauth("wrong-password-71c2"));
    expect(wrong.event).toMatchObject({
      action: "auth.reauthenticated",
      outcome: "failure",
      error_code: "invalid_password",
    });
    const missing = await oneEvent(world.db, () => reauth(42));
    expect(missing.event).toMatchObject({
      action: "auth.reauthenticated",
      error_code: "validation",
      details: { refusal: { fields: [{ field: "password", error: "invalid_type" }] } },
    });
  });
});

describe("API tokens", () => {
  it("logs creating and revoking with mode, permissions and prefix, never the token", async () => {
    ({ auth: ada } = await signedIn(world, "cid"));
    const { result, event } = await oneEvent(world.db, () =>
      apiToken(world, ada, { name: "laptop", permissions: ["read", "search"] }),
    );
    const created = result as { id: string; token: string };
    secrets.add(created.token);
    secrets.add(created.token.slice(4));
    expect(event).toMatchObject({
      actor_name: "cid",
      action: "token.created",
      target_kind: "token",
      target_id: created.id,
      target_label: "laptop",
      details: {
        tokenPrefix: created.token.slice(0, 8),
        mode: "deny_list",
        basePermissions: ["read", "search"],
        entries: [],
        expiresAt: null,
      },
    });
    const revoke = () => call(world.server, ada, "DELETE", `/api/tokens/v1/tokens/${created.id}`);
    const revoked = await oneEvent(world.db, revoke);
    expect(revoked.event).toMatchObject({
      action: "token.revoked",
      details: { alreadyRevoked: false },
    });
    const again = await oneEvent(world.db, revoke);
    expect(again.event).toMatchObject({
      action: "token.revoked",
      details: { alreadyRevoked: true },
    });
    const invalid = await oneEvent(world.db, () =>
      call(world.server, ada, "POST", "/api/tokens/v1/tokens", { name: "", permissions: [] }),
    );
    expect(invalid.event).toMatchObject({
      action: "token.created",
      outcome: "failure",
      error_code: "validation",
    });
  });
});
