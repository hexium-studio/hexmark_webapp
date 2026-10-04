import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { TestDatabase } from "../support/databases";
import { tryInsert } from "./two-factor-harness";

// Shared helpers for the tests of migration 0005 (folders, notes, revisions,
// sections, API tokens).

export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

// The actor triple for a human, as the application writes it.
export function byUser(prefix: string, userId: string, name = "owner") {
  return { [`${prefix}_user_id`]: userId, [`${prefix}_name`]: name };
}

// The actor triple for an agent.
export function byToken(prefix: string, tokenId: string, name = "agent") {
  return { [`${prefix}_token_id`]: tokenId, [`${prefix}_name`]: name };
}

// The trash columns of a row a human moved to the trash (migration 0007),
// as a batch of its own unless one is given.
export function trashedBy(userId: string, batchId: string = randomUUID(), name = "owner") {
  return {
    deleted_at: new Date(),
    ...byUser("deleted_by", userId, name),
    trash_batch_id: batchId,
  };
}

// A token row as the token service stores it before migration 0010: digest
// and the first eight characters of "hmk_" + base64url, permissions and
// (null) folder scope.
export function legacyTokenRow(userId: string, values: Record<string, unknown> = {}) {
  const token = `hmk_${randomBytes(32).toString("base64url")}`;
  return {
    user_id: userId,
    name: `agent-${randomBytes(3).toString("hex")}`,
    token_hash: createHash("sha256").update(token).digest("hex"),
    token_prefix: token.slice(0, 8),
    permissions: ["read", "search"],
    ...values,
  };
}

// A token row for the schema since migration 0010: the whole wiki (deny_list
// without entries) with read and search. The legacy columns stay filled as
// a server of the previous version writes them.
export function tokenRow(userId: string, values: Record<string, unknown> = {}) {
  return legacyTokenRow(userId, {
    access_mode: "deny_list",
    base_permissions: ["read", "search"],
    ...values,
  });
}

export async function insertRow(
  db: TestDatabase,
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [inserted] = await db.sql`insert into ${db.sql(table)} ${db.sql(row)} returning *`;
  if (!inserted) throw new Error(`no row inserted into ${table}`);
  return inserted;
}

// Inserts a token in the shape of the database's schema (before or since
// migration 0010), so tests seeding an older schema can use it too.
export async function insertToken(
  db: TestDatabase,
  userId: string,
  values: Record<string, unknown> = {},
): Promise<string> {
  const [current] = await db.sql`
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'api_tokens' and column_name = 'access_mode'
  `;
  const row = current ? tokenRow(userId, values) : legacyTokenRow(userId, values);
  return (await insertRow(db, "api_tokens", row)).id as string;
}

export async function insertFolder(
  db: TestDatabase,
  userId: string,
  values: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    name: `folder-${randomBytes(3).toString("hex")}`,
    ...byUser("created_by", userId),
    ...byUser("updated_by", userId),
    ...values,
  };
  return (await insertRow(db, "folders", row)).id as string;
}

export function noteRow(userId: string, values: Record<string, unknown> = {}) {
  return {
    title: `note-${randomBytes(3).toString("hex")}`,
    body: "",
    ...byUser("created_by", userId),
    ...byUser("updated_by", userId),
    ...values,
  };
}

export async function insertNote(
  db: TestDatabase,
  userId: string,
  values: Record<string, unknown> = {},
): Promise<string> {
  return (await insertRow(db, "notes", noteRow(userId, values))).id as string;
}

// The row is refused, by exactly this constraint.
export async function expectRefused(
  db: TestDatabase,
  table: string,
  row: Record<string, unknown>,
  constraint: string,
): Promise<void> {
  await expect(tryInsert(db, table, row)).rejects.toMatchObject({ constraint_name: constraint });
}

// The row is accepted (inserted and rolled back).
export async function expectAccepted(
  db: TestDatabase,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  await expect(tryInsert(db, table, row)).resolves.toBeUndefined();
}
