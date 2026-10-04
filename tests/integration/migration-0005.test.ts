import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";
import { count, digest, sealed } from "./two-factor-harness";

// Migration 0005 on a database that already holds data from 0000-0004: it
// only adds tables, so every existing row keeps every value, and the new
// tables start empty.

const EXISTING_TABLES = [
  "users",
  "instance_settings",
  "sessions",
  "auth_challenges",
  "recovery_codes",
  "totp_credentials",
  "webauthn_credentials",
];
const NEW_TABLES = ["folders", "notes", "note_revisions", "note_sections", "api_tokens"];

describe("migration 0005 on a database with existing rows", () => {
  it("keeps users, settings, sessions and second factors unchanged", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(5));
    const [admin] = await db.sql`
      insert into users (email, username, display_name, password_hash, role, locale, timezone, created_at)
      values ('admin@example.com', 'admin', 'Admin', 'x', 'admin', 'de', 'Europe/Berlin',
        '2026-01-01T00:00:00Z')
      returning id
    `;
    const [guest] = await db.sql`
      insert into users (email, username, display_name, password_hash, role, locale)
      values ('guest@example.com', 'guest', 'Guest', 'x', 'guest', 'pt-BR') returning id
    `;
    await db.sql`
      insert into instance_settings (id, default_locale, default_timezone, require_two_factor)
      values (1, 'de', 'Europe/Berlin', true)
    `;
    const now = Date.now();
    await db.sql`
      insert into sessions (user_id, token_hash, remember, expires_at, reauthenticated_at, user_agent)
      values (${admin?.id}, ${digest()}, true, ${new Date(now + 86_400_000)}, ${new Date(now)}, 'Mozilla/5.0'),
        (${guest?.id}, ${digest()}, false, ${new Date(now + 3_600_000)}, null, null)
    `;
    await db.sql`
      insert into totp_credentials (user_id, secret_encrypted, confirmed_at, last_used_step)
      values (${admin?.id}, ${sealed()}, ${new Date(now)}, 59_000_000),
        (${guest?.id}, ${sealed()}, null, null)
    `;
    await db.sql`
      insert into webauthn_credentials (user_id, credential_id, public_key, counter, transports, name,
        device_type, backed_up, last_used_at)
      values (${admin?.id}, ${randomBytes(32).toString("base64url")}, ${randomBytes(77)}, 12,
        ${["usb", "nfc"]}, 'YubiKey', 'singleDevice', false, ${new Date(now)})
    `;
    await db.sql`
      insert into recovery_codes (user_id, code_hash, used_at)
      values (${admin?.id}, ${digest()}, ${new Date(now)}), (${admin?.id}, ${digest()}, null),
        (${admin?.id}, ${digest()}, null)
    `;
    await db.sql`
      insert into auth_challenges (user_id, token_hash, purpose, attempts, expires_at)
      values (${admin?.id}, ${digest()}, 'second_factor', 2, ${new Date(now + 300_000)})
    `;
    const before = new Map<string, unknown>();
    for (const table of EXISTING_TABLES) {
      before.set(table, await db.sql`select * from ${db.sql(table)} order by 1`);
    }

    await migrate(db, firstMigrations(6));

    for (const table of EXISTING_TABLES) {
      expect(await db.sql`select * from ${db.sql(table)} order by 1`, table).toEqual(
        before.get(table),
      );
    }
    for (const table of NEW_TABLES) expect(await count(db, table), table).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(6);

    await migrate(db, firstMigrations(6));
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(6);

    // The existing accounts can be used by the new tables right away.
    await db.sql`
      insert into notes (title, body, created_by_user_id, created_by_name, updated_by_user_id, updated_by_name)
      values ('First', 'hello', ${admin?.id}, 'admin', ${admin?.id}, 'admin')
    `;
    expect(await count(db, "notes")).toBe(1);
  });

  it("upgrades an instance whose setup is not done yet", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(5));

    await migrate(db, firstMigrations(6));

    for (const table of [...EXISTING_TABLES, ...NEW_TABLES]) expect(await count(db, table)).toBe(0);
    expect(await count(db, "drizzle.__drizzle_migrations")).toBe(6);
  });
});
