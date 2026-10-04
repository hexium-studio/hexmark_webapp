import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import type { HexmarkServer } from "../support/hexmark-server";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { login, PASSWORD, type SeededUser, seedUser, signIn } from "./auth-harness";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import {
  addKey,
  awayFromStepEdge,
  call,
  enableTotp,
  forgetLastTotpStep,
  reauthenticate,
  totp,
  twoFactorServer,
} from "./two-factor-api";

// Second factors in the audit log: adding and removing them, security keys
// renamed, recovery codes made and used, and the second step of signing in
// (right and wrong). Never in the log: TOTP secrets and codes, recovery
// codes, key answers.

let db: TestDatabase;
let server: HexmarkServer;
let ada: SeededUser;
let session: string;
let secret = "";
let codes: string[] = [];
const secrets = new Set([PASSWORD]);

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
  server = await twoFactorServer(db);
  ada = await seedUser(db, "ada");
  session = await signIn(server, ada.email);
  secrets.add(session);
});

afterAll(async () => {
  for (const code of codes) {
    secrets.add(code);
    secrets.add(code.replaceAll("-", ""));
  }
  secrets.add(secret);
  expect(await expectNoSecrets(db, secrets)).toBeGreaterThan(8);
});

const byAda = () => ({
  actor_kind: "human",
  actor_user_id: ada.id,
  actor_name: "ada",
  source: "web",
});

describe("the authenticator app", () => {
  it("is logged when added (not when started) and when removed", async () => {
    const { result, events } = await eventsOf(db, () => enableTotp(server, { session }));
    ({ secret } = result as { secret: string });
    codes = (result as { recoveryCodes: string[] }).recoveryCodes;
    expect(events).toEqual([
      expect.objectContaining({
        ...byAda(),
        action: "two_factor.totp_added",
        outcome: "success",
        target_kind: "user",
        details: { context: "account", recoveryCodeCount: 3 },
      }),
    ]);
    const invalid = await oneEvent(db, () =>
      call(server, "POST", "/account/v1/totp/confirm", { session }, { code: "12" }),
    );
    expect(invalid.event).toMatchObject({
      action: "two_factor.totp_added",
      error_code: "validation",
    });
  });
});

describe("signing in with a second factor", () => {
  const challenge = async () =>
    (
      (await login(server, { email: ada.email, password: PASSWORD, remember: false })).body
        .challenge as { token: string }
    ).token;

  it("logs a wrong code as a failure and a right one with the sign-in", async () => {
    const token = await challenge();
    const answer = (code: string) =>
      call(server, "POST", "/auth/v1/second-factor/totp", { challenge: token }, { code });
    const wrong = await oneEvent(db, () => answer("000000"));
    expect(wrong.event).toMatchObject({
      ...byAda(),
      action: "auth.second_factor_verified",
      outcome: "failure",
      error_code: "invalid_code",
      details: { method: "totp" },
    });
    await forgetLastTotpStep(db, ada.id);
    await awayFromStepEdge();
    const right = await eventsOf(db, () => answer(totp(secret)));
    expect(right.events.map((e) => [e.action, e.outcome, e.details.method])).toEqual([
      ["auth.second_factor_verified", "success", "totp"],
      ["auth.sign_in", "success", "totp"],
    ]);
  });

  it("logs a recovery code used, with how many are left", async () => {
    const token = await challenge();
    const { events } = await eventsOf(db, () =>
      call(
        server,
        "POST",
        "/auth/v1/second-factor/recovery-code",
        { challenge: token },
        {
          code: codes[0],
        },
      ),
    );
    expect(events.map((e) => [e.action, e.details])).toEqual([
      ["auth.second_factor_verified", { method: "recovery_code", recoveryCodesLeft: 2 }],
      ["auth.sign_in", { method: "recovery_code", remember: false, sessionId: expect.any(String) }],
    ]);
  });
});

describe("account changes", () => {
  it("logs new recovery codes and refuses (logged) without the password re-entered", async () => {
    const stale = await oneEvent(db, () =>
      call(server, "POST", "/account/v1/recovery-codes/regenerate", { session }),
    );
    expect(stale.event).toMatchObject({
      action: "two_factor.recovery_codes_regenerated",
      outcome: "failure",
      error_code: "reauthentication_required",
    });
    await reauthenticate(server, session);
    const fresh = await oneEvent(db, () =>
      call(server, "POST", "/account/v1/recovery-codes/regenerate", { session }),
    );
    codes.push(...(fresh.result as { body: { recoveryCodes: string[] } }).body.recoveryCodes);
    expect(fresh.event).toMatchObject({
      ...byAda(),
      action: "two_factor.recovery_codes_regenerated",
      details: { context: "account", recoveryCodeCount: 3 },
    });
  });

  it("logs security keys added, renamed and removed by their id and name", async () => {
    const added = await oneEvent(db, () => addKey(server, { session }, "Desk key"));
    const id = (added.result as { verify: { body: { credential: { id: string } } } }).verify.body
      .credential.id;
    expect(added.event).toMatchObject({
      action: "two_factor.security_key_added",
      target_kind: "security_key",
      target_id: id,
      target_label: "Desk key",
      details: { context: "account", recoveryCodeCount: 0 },
    });
    const renamed = await oneEvent(db, () =>
      call(server, "PATCH", `/account/v1/webauthn/${id}`, { session }, { name: "Travel key" }),
    );
    expect(renamed.event).toMatchObject({
      action: "two_factor.security_key_renamed",
      target_label: "Travel key",
      details: { previousName: "Desk key", name: "Travel key" },
    });
    const removed = await oneEvent(db, () =>
      call(server, "DELETE", `/account/v1/webauthn/${id}`, { session }),
    );
    expect(removed.event).toMatchObject({
      action: "two_factor.security_key_removed",
      target_id: id,
      target_label: "Travel key",
    });
    const gone = await oneEvent(db, () => call(server, "DELETE", "/account/v1/totp", { session }));
    expect(gone.event).toMatchObject({ ...byAda(), action: "two_factor.totp_removed" });
  });
});
