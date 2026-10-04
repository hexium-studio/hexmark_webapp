import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { TEST_SETUP_TOKEN } from "../support/hexmark-server";
import { eventsOf, expectNoSecrets, oneEvent } from "./audit-log-harness";
import { login, PASSWORD, seedUser } from "./auth-harness";
import { adminInput, newDatabase, newServer, postJson } from "./harness";
import { migrate } from "./migrations";
import { call, enableTotp, ORIGIN, setRequireTwoFactor, twoFactorServer } from "./two-factor-api";

// The setup wizard and forced enrolment in the audit log: the first admin,
// the second factor added with the setup ticket, the system settings with
// their old and new values, and a first factor added while signing in.
// Never in the log: the setup token, the ticket, the e-mail, the password.

let db: TestDatabase;
const secrets = new Set([PASSWORD, TEST_SETUP_TOKEN, "ada@example.com"]);

beforeAll(async () => {
  db = await newDatabase();
  await migrate(db);
});

afterAll(async () => {
  expect(await expectNoSecrets(db, secrets)).toBeGreaterThan(4);
});

describe("the setup wizard", () => {
  it("logs the admin, the second factor and the settings with old and new values", async () => {
    const server = await newServer(db, { env: { PUBLIC_ORIGIN: ORIGIN } });
    const created = await oneEvent(db, () =>
      postJson(server, "/api/setup/v1/create-first-admin", adminInput()),
    );
    const response = created.result as { status: number; body: { ticket: { token: string } } };
    expect(response.status).toBe(201);
    const ticket = response.body.ticket.token;
    secrets.add(ticket);
    const adminId = (await db.sql`select id from users where username = 'ada'`)[0]?.id;
    expect(created.event).toMatchObject({
      actor_kind: "human",
      actor_user_id: adminId,
      actor_name: "ada",
      source: "web",
      action: "setup.admin_created",
      target_kind: "user",
      target_id: adminId,
      details: { role: "admin", locale: "de" },
    });

    const totp = await eventsOf(db, () =>
      enableTotp(server, { challenge: ticket }, "/setup/v1/two-factor"),
    );
    secrets.add((totp.result as { secret: string }).secret);
    expect(totp.events).toEqual([
      expect.objectContaining({
        actor_user_id: adminId,
        action: "two_factor.totp_added",
        details: { context: "setup", recoveryCodeCount: 3 },
      }),
    ]);

    const settings = await oneEvent(db, () =>
      call(
        server,
        "PUT",
        "/setup/v1/system-settings",
        { challenge: ticket },
        {
          timezone: "Europe/Berlin",
          requireTwoFactor: true,
        },
      ),
    );
    expect((settings.result as { status: number }).status).toBe(200);
    expect(settings.event).toMatchObject({
      actor_user_id: adminId,
      action: "settings.changed",
      target_kind: "settings",
      target_label: "instance",
      details: {
        context: "setup",
        previous: { timezone: "UTC", requireTwoFactor: false },
        next: { timezone: "Europe/Berlin", requireTwoFactor: true },
      },
    });
  });
});

describe("forced enrolment", () => {
  it("logs the first factor (context sign_in_enrolment) and the sign-in it completes", async () => {
    const server = await twoFactorServer(db);
    await setRequireTwoFactor(db, true);
    const bob = await seedUser(db, "bob");
    secrets.add(bob.email);
    const answer = await login(server, { email: bob.email, password: PASSWORD, remember: false });
    const token = (answer.body.challenge as { token: string }).token;
    secrets.add(token);
    const { events } = await eventsOf(db, () =>
      enableTotp(server, { challenge: token }, "/auth/v1/enrolment"),
    );
    expect(
      events.map((e) => [e.actor_name, e.action, e.details.context ?? e.details.method]),
    ).toEqual([
      ["bob", "two_factor.totp_added", "sign_in_enrolment"],
      ["bob", "auth.sign_in", "enrolment"],
    ]);
  });
});
