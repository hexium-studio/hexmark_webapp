import { API_TOKEN_NAME_MAX_LENGTH, NOTE_PERMISSIONS, type NotePermission } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idColumn } from "./id-column";
import { users } from "./users";

// Note permissions a token can hold (NOTE_PERMISSIONS in @hexmark/shared).
// Changing the list needs a migration of api_tokens_permissions_check below.
export const API_TOKEN_PERMISSIONS = NOTE_PERMISSIONS;
export type ApiTokenPermission = NotePermission;

export { API_TOKEN_NAME_MAX_LENGTH };

const permissionList = sql.raw(
  `ARRAY[${API_TOKEN_PERMISSIONS.map((permission) => `'${permission}'`).join(", ")}]::text[]`,
);

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
    permissions: text("permissions").array().$type<ApiTokenPermission[]>().notNull(),
    // Null: the whole wiki. Otherwise these folders and their subfolders.
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
