import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { migrate } from "./migrations";
import { digest, insertUser, tryInsert, violation } from "./two-factor-harness";

// Columns migration 0004 adds to existing tables: time zones (form check only;
// the application validates IANA names), require_two_factor and
// sessions.reauthenticated_at.

const ACCEPTED = [
  "UTC",
  "Europe/Berlin",
  "America/Argentina/Buenos_Aires",
  "Etc/GMT+5",
  "x".repeat(64),
];
const REFUSED = ["", " ", "Europe/ Berlin", "Europe/Berlin ", "UTC\t", "x".repeat(65)];

describe("time zone columns", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await newDatabase();
    await migrate(db);
  });

  function user(timezone: unknown): Record<string, unknown> {
    return {
      email: "tz@example.com",
      username: "tz",
      display_name: "Tz",
      password_hash: "x",
      role: "user",
      timezone,
    };
  }

  it("leaves a new user's time zone empty (instance default)", async () => {
    const id = await insertUser(db, "plain");
    expect(await db.sql`select timezone from users where id = ${id}`).toEqual([{ timezone: null }]);
  });

  it.each(ACCEPTED)("accepts %j as a user's time zone", async (timezone) => {
    await expect(tryInsert(db, "users", user(timezone))).resolves.toBeUndefined();
  });

  it.each(REFUSED)("refuses %j as a user's time zone", async (timezone) => {
    await expect(tryInsert(db, "users", user(timezone))).rejects.toMatchObject(violation.check);
  });

  it.each(ACCEPTED)("accepts %j as the instance time zone", async (timezone) => {
    await expect(
      tryInsert(db, "instance_settings", { id: 1, default_timezone: timezone }),
    ).resolves.toBeUndefined();
  });

  it.each(REFUSED)("refuses %j as the instance time zone", async (timezone) => {
    await expect(
      tryInsert(db, "instance_settings", { id: 1, default_timezone: timezone }),
    ).rejects.toMatchObject(violation.check);
  });

  it("requires an instance time zone and the two-factor flag", async () => {
    await expect(
      tryInsert(db, "instance_settings", { id: 1, default_timezone: null }),
    ).rejects.toMatchObject(violation.notNull);
    await expect(
      tryInsert(db, "instance_settings", { id: 1, require_two_factor: null }),
    ).rejects.toMatchObject(violation.notNull);
  });

  it("fills the defaults for a new settings row", async () => {
    await db.sql`insert into instance_settings (id) values (1)`;
    expect(
      await db.sql`select default_timezone, require_two_factor from instance_settings`,
    ).toEqual([{ default_timezone: "UTC", require_two_factor: false }]);
    await db.sql`update instance_settings set require_two_factor = true, default_timezone = 'Europe/Berlin'`;
    expect(
      await db.sql`select default_timezone, require_two_factor from instance_settings`,
    ).toEqual([{ default_timezone: "Europe/Berlin", require_two_factor: true }]);
    await db.sql`delete from instance_settings`;
  });
});

describe("sessions.reauthenticated_at", () => {
  it("is empty for a new session and can be set", async () => {
    const db = await newDatabase();
    await migrate(db);
    const userId = await insertUser(db, "owner");
    const [session] = await db.sql`
      insert into sessions (user_id, token_hash, remember, expires_at)
      values (${userId}, ${digest()}, false, now() + interval '1 hour')
      returning id, reauthenticated_at
    `;
    expect(session?.reauthenticated_at).toBeNull();
    const at = new Date();
    await db.sql`update sessions set reauthenticated_at = ${at} where id = ${session?.id}`;
    expect(await db.sql`select reauthenticated_at from sessions`).toEqual([
      { reauthenticated_at: at },
    ]);
  });
});
