import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/databases";
import { newDatabase } from "./harness";
import { firstMigrations, migrate } from "./migrations";

// The sessions table (migration 0003): the rules the database enforces on
// its own, independent of the session service.

const violation = { check: { code: "23514" }, unique: { code: "23505" } };

// What the service stores: the SHA-256 digest of a random token as hex.
function tokenHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

async function insertUser(db: TestDatabase, username: string, locale = "en"): Promise<string> {
  const [row] = await db.sql`
    insert into users (email, username, display_name, password_hash, role, locale)
    values (${`${username}@example.com`}, ${username}, ${username}, 'x', 'user', ${locale})
    returning id
  `;
  return row?.id as string;
}

describe("migration 0003 on a database with users", () => {
  it("keeps the existing users unchanged and adds an empty sessions table", async () => {
    const db = await newDatabase();
    await migrate(db, firstMigrations(3));
    await insertUser(db, "first", "de");
    await insertUser(db, "second", "pt-BR");
    await db.sql`insert into instance_settings (id, default_locale) values (1, 'de')`;
    const before = await db.sql`select * from users order by username`;
    const settingsBefore = await db.sql`select * from instance_settings`;

    await migrate(db, firstMigrations(4));

    expect(await db.sql`select * from users order by username`).toEqual(before);
    expect(await db.sql`select * from instance_settings`).toEqual(settingsBefore);
    expect(await db.sql`select count(*)::int as n from sessions`).toEqual([{ n: 0 }]);
    await migrate(db, firstMigrations(4));
    expect(await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`).toEqual([
      { n: 4 },
    ]);
  });
});

describe("sessions table", () => {
  let db: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    db = await newDatabase();
    await migrate(db);
    userId = await insertUser(db, "owner");
  });

  function row(values: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      user_id: userId,
      token_hash: tokenHash(),
      remember: false,
      expires_at: new Date(Date.now() + 3_600_000),
      ...values,
    };
  }

  // Inserts inside a transaction that is rolled back, so tests stay independent.
  async function tryInsert(values: Record<string, unknown> = {}): Promise<void> {
    await db.sql
      .begin(async (tx) => {
        await tx`insert into sessions ${tx(row(values))}`;
        throw new Error("rollback");
      })
      .catch((error: Error) => {
        if (error.message !== "rollback") throw error;
      });
  }

  it("accepts a complete row and fills id and timestamps", async () => {
    const [created] = await db.sql`insert into sessions ${db.sql(row())} returning *`;
    expect(created).toMatchObject({
      user_id: userId,
      remember: false,
      previous_token_hash: null,
      previous_valid_until: null,
      revoked_at: null,
      user_agent: null,
    });
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created?.created_at).toBeInstanceOf(Date);
    expect(created?.last_seen_at).toEqual(created?.created_at);
    expect(created?.rotated_at).toEqual(created?.created_at);
    await db.sql`delete from sessions`;
  });

  it("requires remember to be set", async () => {
    await expect(tryInsert({ remember: null })).rejects.toMatchObject({ code: "23502" });
  });

  it("refuses an end that is not after the start", async () => {
    const now = new Date();
    await expect(tryInsert({ created_at: now, expires_at: now })).rejects.toMatchObject(
      violation.check,
    );
    await expect(
      tryInsert({ created_at: now, expires_at: new Date(now.getTime() - 1000) }),
    ).rejects.toMatchObject(violation.check);
  });

  it.each([
    ["the raw token (base64url)", randomBytes(32).toString("base64url")],
    ["upper-case hex", "A".repeat(64)],
    ["a short digest", "a".repeat(63)],
    ["an empty string", ""],
  ])("refuses %s as token_hash", async (_label, value) => {
    await expect(tryInsert({ token_hash: value })).rejects.toMatchObject(violation.check);
  });

  it("refuses a token_hash that is already in use", async () => {
    const hash = tokenHash();
    await db.sql`insert into sessions ${db.sql(row({ token_hash: hash }))}`;
    await expect(tryInsert({ token_hash: hash })).rejects.toMatchObject(violation.unique);
    await db.sql`delete from sessions`;
  });

  it("keeps the previous token and its validity together", async () => {
    const until = new Date(Date.now() + 30_000);
    await expect(
      tryInsert({ previous_token_hash: tokenHash(), previous_valid_until: until }),
    ).resolves.toBeUndefined();
    await expect(tryInsert({ previous_token_hash: tokenHash() })).rejects.toMatchObject(
      violation.check,
    );
    await expect(tryInsert({ previous_valid_until: until })).rejects.toMatchObject(violation.check);
    await expect(
      tryInsert({ previous_token_hash: "not-a-digest", previous_valid_until: until }),
    ).rejects.toMatchObject(violation.check);
    const hash = tokenHash();
    await expect(
      tryInsert({ token_hash: hash, previous_token_hash: hash, previous_valid_until: until }),
    ).rejects.toMatchObject(violation.check);
  });

  it("limits the user agent to 256 characters", async () => {
    await expect(tryInsert({ user_agent: "x".repeat(256) })).resolves.toBeUndefined();
    await expect(tryInsert({ user_agent: "x".repeat(257) })).rejects.toMatchObject(violation.check);
  });

  it("refuses a session of an unknown user", async () => {
    await expect(
      tryInsert({ user_id: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("deletes a user's sessions with the user and keeps everyone else's", async () => {
    const leaving = await insertUser(db, "leaving");
    const staying = await insertUser(db, "staying");
    await db.sql`insert into sessions ${db.sql([row({ user_id: leaving }), row({ user_id: leaving, remember: true }), row({ user_id: staying })])}`;
    const kept = await db.sql`select * from sessions where user_id = ${staying}`;

    await db.sql`delete from users where id = ${leaving}`;

    expect(
      await db.sql`select count(*)::int as n from sessions where user_id = ${leaving}`,
    ).toEqual([{ n: 0 }]);
    expect(await db.sql`select * from sessions where user_id = ${staying}`).toEqual(kept);
  });
});
