import { createHash, randomBytes } from "node:crypto";
import type { TestDatabase } from "../support/databases";

// Shared helpers for the tests of migration 0004 (two-factor tables).

export const violation = {
  check: { code: "23514" },
  unique: { code: "23505" },
  foreignKey: { code: "23503" },
  notNull: { code: "23502" },
};

export const UNKNOWN_USER = "00000000-0000-4000-8000-000000000000";

// A SHA-256 / HMAC-SHA256 digest as lower-case hex, as the services store it.
export function digest(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

// What lib/crypto.ts produces: "v1.<key id>.<base64url>".
export function sealed(): string {
  return `v1.k1.${randomBytes(48).toString("base64url")}`;
}

export async function insertUser(db: TestDatabase, username: string): Promise<string> {
  const [row] = await db.sql`
    insert into users (email, username, display_name, password_hash, role)
    values (${`${username}@example.com`}, ${username}, ${username}, 'x', 'user')
    returning id
  `;
  return row?.id as string;
}

// Inserts one row inside a transaction that is rolled back, so tests stay
// independent; resolves when the database accepted the row.
export async function tryInsert(
  db: TestDatabase,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  await db.sql
    .begin(async (tx) => {
      await tx`insert into ${tx(table)} ${tx(row)}`;
      throw new Error("rollback");
    })
    .catch((error: Error) => {
      if (error.message !== "rollback") throw error;
    });
}

export async function count(db: TestDatabase, table: string, userId?: string): Promise<number> {
  const [row] = userId
    ? await db.sql`select count(*)::int as n from ${db.sql(table)} where user_id = ${userId}`
    : await db.sql`select count(*)::int as n from ${db.sql(table)}`;
  return row?.n as number;
}
