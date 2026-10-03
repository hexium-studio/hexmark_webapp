import { describe, expect, it } from "vitest";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import { count, digest } from "./two-factor-harness";

// Migration 0004 on a database that already holds data from 0000-0003: the
// existing rows keep every value and only gain the new columns with their
// documented values; the new tables start empty.

const NEW_TABLES = [
  "auth_challenges",
  "recovery_codes",
  "totp_credentials",
  "webauthn_credentials",
];

describe("migration 0004 on a database with existing rows", () => {
  it("keeps users, settings and sessions and adds only the new columns", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(4));
    const [admin] = await db.sql`
      insert into users (email, username, display_name, password_hash, role, locale, created_at)
      values ('admin@example.com', 'admin', 'Admin', 'x', 'admin', 'de', '2026-01-01T00:00:00Z')
      returning id
    `;
    await db.sql`
      insert into users (email, username, display_name, password_hash, role, locale)
      values ('guest@example.com', 'guest', 'Guest', 'x', 'guest', 'pt-BR')
    `;
    await db.sql`insert into instance_settings (id, default_locale) values (1, 'de')`;
    const now = Date.now();
    await db.sql`insert into sessions ${db.sql([
      // Both rows list the same columns: a multi-row insert takes them from the first.
      // Active, rotated recently (previous token still valid).
      {
        user_id: admin?.id,
        token_hash: digest(),
        previous_token_hash: digest(),
        previous_valid_until: new Date(now + 30_000),
        remember: true,
        created_at: new Date(now - 60_000),
        expires_at: new Date(now + 86_400_000),
        user_agent: "Mozilla/5.0",
        revoked_at: null,
      },
      // Revoked, and long expired.
      {
        user_id: admin?.id,
        token_hash: digest(),
        previous_token_hash: null,
        previous_valid_until: null,
        remember: false,
        created_at: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-01-29T00:00:00Z"),
        user_agent: null,
        revoked_at: new Date("2026-01-02T00:00:00Z"),
      },
    ])}`;
    const users = await db.sql`select * from users order by username`;
    const settings = await db.sql`select * from instance_settings`;
    const sessions = await db.sql`select * from sessions order by created_at`;

    await migrate(db);

    expect(await db.sql`select * from users order by username`).toEqual(
      users.map((row) => ({ ...row, timezone: null })),
    );
    expect(await db.sql`select * from instance_settings`).toEqual(
      settings.map((row) => ({ ...row, default_timezone: "UTC", require_two_factor: false })),
    );
    expect(await db.sql`select * from sessions order by created_at`).toEqual(
      sessions.map((row) => ({ ...row, reauthenticated_at: null })),
    );
    for (const table of NEW_TABLES) expect(await count(db, table)).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(5);

    await migrate(db);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(5);
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(4));

    await migrate(db);

    expect(await count(db, "users")).toBe(0);
    expect(await count(db, "instance_settings")).toBe(0);
    const [created] = await db.sql`insert into instance_settings (id) values (1) returning *`;
    expect(created).toMatchObject({ default_timezone: "UTC", require_two_factor: false });
  });
});
