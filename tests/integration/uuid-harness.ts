import { randomBytes } from "node:crypto";
import type { TestDatabase } from "../support/databases";
import { byUser, insertFolder, insertNote, insertRow, insertToken } from "./notes-harness";
import { digest, insertUser, sealed } from "./two-factor-harness";

// Helpers for the tests of migration 0008 (UUID version 7 ids).

// Every table whose id the database generates.
export const ID_TABLES = [
  "users",
  "sessions",
  "totp_credentials",
  "webauthn_credentials",
  "recovery_codes",
  "auth_challenges",
  "api_tokens",
  "folders",
  "notes",
  "note_revisions",
] as const;

export type IdTable = (typeof ID_TABLES)[number];

// Rows that may already exist, for `owner` and below `parent` when given
// (otherwise for a new user and at the root level): one row in every table
// with a generated id, all ids left to the column default. The second
// factors always belong to a new user (one authenticator app per user).
export async function seedEveryTable(
  db: TestDatabase,
  base: { owner?: string; parent?: string; note?: string } = {},
): Promise<Record<IdTable, string>> {
  const tag = randomBytes(3).toString("hex");
  const user = await insertUser(db, `user-${tag}`);
  const owner = base.owner ?? user;
  const now = Date.now();
  const id = async (table: string, row: Record<string, unknown>) =>
    (await insertRow(db, table, row)).id as string;
  const folder = await insertFolder(db, owner, { parent_id: base.parent ?? null });
  const note = await insertNote(db, owner, { folder_id: folder, body: "# Plan\n" });
  await insertRow(db, "note_sections", {
    note_id: note,
    position: 0,
    level: 1,
    heading: "Plan",
    path: "Plan",
    start_offset: 0,
    end_offset: 7,
    subtree_end_offset: 7,
    characters: 7,
    approx_tokens: 2,
    search: db.sql`to_tsvector('simple', 'Plan')`,
  });
  return {
    users: user,
    sessions: await id("sessions", {
      user_id: owner,
      token_hash: digest(),
      remember: true,
      expires_at: new Date(now + 86_400_000),
    }),
    totp_credentials: await id("totp_credentials", { user_id: user, secret_encrypted: sealed() }),
    webauthn_credentials: await id("webauthn_credentials", {
      user_id: owner,
      credential_id: randomBytes(32).toString("base64url"),
      public_key: randomBytes(77),
      counter: 0,
      transports: ["usb"],
      name: `Key ${tag}`,
      device_type: "singleDevice",
      backed_up: false,
    }),
    recovery_codes: await id("recovery_codes", { user_id: owner, code_hash: digest() }),
    auth_challenges: await id("auth_challenges", {
      user_id: owner,
      token_hash: digest(),
      purpose: "second_factor",
      expires_at: new Date(now + 300_000),
    }),
    api_tokens: await insertToken(db, owner),
    folders: folder,
    notes: note,
    note_revisions: await id("note_revisions", {
      note_id: base.note ?? note,
      version: base.note ? 2 : 1,
      title: "Plan",
      body: "# Plan\n",
      change: base.note ? "edited" : "created",
      ...byUser("actor", owner),
    }),
  };
}

// The UUID version of each id, read by PostgreSQL itself.
export async function versionsOf(
  db: TestDatabase,
  ids: Record<IdTable, string>,
): Promise<Record<IdTable, number>> {
  const result = {} as Record<IdTable, number>;
  for (const table of ID_TABLES) {
    const [row] = await db.sql`select uuid_extract_version(${ids[table]}::uuid) as v`;
    result[table] = row?.v as number;
  }
  return result;
}

// Every row of every public table, in a stable order.
export async function allRows(db: TestDatabase): Promise<Map<string, unknown[]>> {
  const tables = await db.sql`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  const rows = new Map<string, unknown[]>();
  for (const { tablename } of tables) {
    rows.set(tablename, [...(await db.sql`select * from ${db.sql(tablename)} order by 1, 2`)]);
  }
  return rows;
}
