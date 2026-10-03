import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase, newServer } from "./harness";
import { firstMigrations, migrate } from "./migrations";

// The SQL migrations (apps/server/drizzle) and the rules the database
// enforces on its own, independent of the API's validation. The sessions
// table (sessions-table.test.ts) and the two-factor tables
// (two-factor-*.test.ts, migration-0004.test.ts) have their own files.

describe("migrations", () => {
  it("apply 0000-0004 on an empty database and are idempotent", async () => {
    const db = await newDatabase();
    await migrate(db);
    const applied = await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(applied).toEqual([{ n: 5 }]);
    const tables = await db.sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual([
      "auth_challenges",
      "instance_settings",
      "recovery_codes",
      "sessions",
      "totp_credentials",
      "users",
      "webauthn_credentials",
    ]);
    const checks = await db.sql`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conname in ('users_locale_check', 'instance_settings_default_locale_check')
      order by conname
    `;
    for (const check of checks) expect(check.definition).toContain("[a-z]{2,3}(-[A-Z]{2})?$");
    expect(checks).toHaveLength(2);

    await migrate(db);
    expect(await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`).toEqual(
      applied,
    );
  });

  it("upgrade a database created by 0000 and keep its users (locale 'en')", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(1));
    await db.sql`
      insert into users (email, username, display_name, password_hash, role)
      values ('old@example.com', 'old', 'Old', 'x', 'admin')
    `;
    await migrate(db);
    expect(await db.sql`select username, locale from users`).toEqual([
      { username: "old", locale: "en" },
    ]);
  });

  it("are applied by the server on start", async () => {
    const db = await newDatabase();
    await newServer(db);
    expect(await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`).toEqual([
      { n: 5 },
    ]);
  });
});

describe("check constraints", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await newDatabase();
    await migrate(db);
  });

  async function insertUser(values: Partial<Record<string, string>>) {
    const row = {
      email: "user@example.com",
      username: "user",
      display_name: "User",
      password_hash: "x",
      role: "user",
      locale: "en",
      ...values,
    };
    await db.sql
      .begin(async (tx) => {
        await tx`insert into users ${tx(row)}`;
        throw new Error("rollback");
      })
      .catch((error: Error) => {
        if (error.message !== "rollback") throw error;
      });
  }

  const violation = { code: "23514" };

  it.each(["en", "de", "pt-BR", "de-CH", "fil"])("accepts the locale %s", async (locale) => {
    await expect(insertUser({ locale })).resolves.toBeUndefined();
  });

  it.each(["DE", "de-ch", "de_CH", "english", "e", "de-CHE", ""])(
    "refuses the locale %j",
    async (locale) => {
      await expect(insertUser({ locale })).rejects.toMatchObject(violation);
    },
  );

  it.each(["User@example.com", " user@example.com", "user@example.com "])(
    "refuses the e-mail %j that is not normalised",
    async (email) => {
      await expect(insertUser({ email })).rejects.toMatchObject(violation);
    },
  );

  it("refuses a username with upper case", async () => {
    await expect(insertUser({ username: "User" })).rejects.toMatchObject(violation);
  });

  it("refuses an unknown role", async () => {
    await expect(insertUser({ role: "owner" })).rejects.toMatchObject(violation);
  });

  it("keeps instance_settings to one row with a well-formed locale", async () => {
    await expect(
      db.sql`insert into instance_settings (id, default_locale) values (2, 'en')`,
    ).rejects.toMatchObject(violation);
    await expect(
      db.sql`insert into instance_settings (id, default_locale) values (1, 'EN')`,
    ).rejects.toMatchObject(violation);
    await db.sql`insert into instance_settings (id, default_locale) values (1, 'de-AT')`;
    expect(await db.sql`select default_locale from instance_settings`).toEqual([
      { default_locale: "de-AT" },
    ]);
  });
});
