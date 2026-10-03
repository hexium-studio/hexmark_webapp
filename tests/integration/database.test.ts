import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { startMigrations } from "../../apps/server/src/db/migrate";
import { getDbStatus } from "../../apps/server/src/db/status";
import type { TestDatabase } from "../support/databases";
import { SERVER_MIGRATIONS } from "../support/paths";
import { newDatabase, newServer } from "./harness";

// The SQL migrations (apps/server/drizzle) and the rules the database
// enforces on its own, independent of the API's validation.

function connectionOf(db: TestDatabase) {
  const { host, port, user, password } = db.server;
  return { host, port, user, password, database: db.name };
}

// Runs the server's start-up migration once and waits for the result.
function migrate(db: TestDatabase, folder = SERVER_MIGRATIONS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`migration failed: ${getDbStatus().reason}`)),
      20_000,
    );
    startMigrations({ configured: true, connection: connectionOf(db) }, folder, async () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// A copy of the migrations folder that knows only the first `count` migrations.
function firstMigrations(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hexmark-migrations-"));
  cpSync(SERVER_MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("migrations", () => {
  it("apply 0000-0002 on an empty database and are idempotent", async () => {
    const db = await newDatabase();
    await migrate(db);
    const applied = await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(applied).toEqual([{ n: 3 }]);
    const tables = await db.sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual(["instance_settings", "users"]);
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
      { n: 3 },
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
