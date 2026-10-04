import {
  API_TOKEN_ACCESS_MODES,
  API_TOKEN_NAME_MAX_LENGTH,
  type ApiTokenAccessMode,
  NOTE_PERMISSIONS,
  type NotePermission,
} from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./id-column";
import { users } from "./users";

// Note permissions a token can hold (NOTE_PERMISSIONS in @hexmark/shared).
// Changing the list needs a migration of api_tokens_permissions_check below.
export const API_TOKEN_PERMISSIONS = NOTE_PERMISSIONS;
export type ApiTokenPermission = NotePermission;

export { API_TOKEN_ACCESS_MODES, API_TOKEN_NAME_MAX_LENGTH, type ApiTokenAccessMode };

// How a token's access is described (api-token-entries.ts):
// - allow_list: only the listed folders (with everything below them) and
//   notes, each entry with its own permissions;
// - deny_list: the whole wiki except the listed targets, with one set of
//   permissions (base_permissions) for everything it can reach.
// Chosen when the token is created; there is no default. The list is
// shared with the input schemas (@hexmark/shared, api-token-access.ts).

// A text[] literal of the given values, for checks.
export function textArraySql(values: readonly string[]) {
  return sql.raw(`ARRAY[${values.map((value) => `'${value}'`).join(", ")}]::text[]`);
}

const permissionList = textArraySql(API_TOKEN_PERMISSIONS);

// API tokens for agents ("hmk_" + 32 random bytes as base64url). The token is
// shown once; the database keeps its SHA-256 digest as lower-case hex (the
// format check refuses a raw token stored by mistake) and its first eight
// characters, so a user can recognise it in a list.
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: idColumn(),
    // The owner; a token never exceeds the owner's permissions. Deleting the
    // user deletes their tokens (history keeps the token name, see actor-columns.ts).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Shown as the actor name of the agent's changes.
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique("api_tokens_token_hash_unique"),
    tokenPrefix: text("token_prefix").notNull(),
    accessMode: text("access_mode").$type<ApiTokenAccessMode>().notNull(),
    // deny_list: the permissions for everything not excluded. allow_list:
    // null (each entry carries its own).
    basePermissions: text("base_permissions").array().$type<ApiTokenPermission[]>(),
    // Legacy, replaced by access_mode, base_permissions and the entries
    // (migration 0010 converted every token). Kept for one release so a
    // server of the previous version keeps working on a migrated database
    // (it can use existing tokens, but not create new ones, as it sets no
    // access_mode); nothing new should read or write them. A later migration drops both.
    // Old meaning: the permissions, and null for the whole wiki or else
    // these folders and their subfolders.
    permissions: text("permissions").array().$type<ApiTokenPermission[]>(),
    folderScope: uuid("folder_scope").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // Unique per user regardless of case, also among revoked tokens: the name
    // identifies the agent in the history. Also serves lookups by user_id.
    uniqueIndex("api_tokens_user_id_name_unique").on(table.userId, sql`lower(${table.name})`),
    // Target of the entries' (token_id, token_access_mode) foreign key, so
    // the database knows each entry's mode (api-token-entries.ts).
    unique("api_tokens_id_access_mode_unique").on(table.id, table.accessMode),
    check(
      "api_tokens_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(API_TOKEN_NAME_MAX_LENGTH))}`,
    ),
    check("api_tokens_token_hash_format_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "api_tokens_token_prefix_format_check",
      sql`${table.tokenPrefix} ~ '^hmk_[A-Za-z0-9_-]{4}$'`,
    ),
    // Non-empty, one-dimensional, only known permissions. A null element is
    // refused by the containment test (null is not contained in the list).
    check(
      "api_tokens_permissions_check",
      sql`cardinality(${table.permissions}) > 0 and array_ndims(${table.permissions}) = 1 and ${table.permissions} <@ ${permissionList}`,
    ),
    check(
      "api_tokens_access_mode_check",
      sql`${table.accessMode} in (${sql.raw(API_TOKEN_ACCESS_MODES.map((mode) => `'${mode}'`).join(", "))})`,
    ),
    // Same rules as the old permissions; set exactly for deny_list.
    check(
      "api_tokens_base_permissions_check",
      sql`cardinality(${table.basePermissions}) > 0 and array_ndims(${table.basePermissions}) = 1 and ${table.basePermissions} <@ ${permissionList}`,
    ),
    check(
      "api_tokens_base_permissions_mode_check",
      sql`(${table.accessMode} = 'deny_list') = (${table.basePermissions} is not null)`,
    ),
    // An empty scope would be ambiguous (nothing or everything); null means everything.
    check(
      "api_tokens_folder_scope_check",
      sql`cardinality(${table.folderScope}) > 0 and array_ndims(${table.folderScope}) = 1 and array_position(${table.folderScope}, null) is null`,
    ),
    check("api_tokens_expires_after_created_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
