import {
  FOLDER_ENTRY_PERMISSIONS,
  NOTE_ENTRY_PERMISSIONS,
  TOKEN_ENTRY_KINDS,
  type TokenEntryKind,
} from "@hexmark/shared";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApiTokenAccessMode,
  type ApiTokenPermission,
  apiTokens,
  textArraySql,
} from "./api-tokens";
import { folders } from "./folders";
import { idColumn } from "./id-column";
import { notes } from "./notes";

// What an entry can point at, and which permissions an entry for a folder
// (all) or a single note (no create or search; a readable note is still
// found by search) can carry: @hexmark/shared (api-token-access.ts).
export const API_TOKEN_ENTRY_TARGET_KINDS = TOKEN_ENTRY_KINDS;
export type ApiTokenEntryTargetKind = TokenEntryKind;

// The targets of a token's access list (api_tokens.access_mode): in
// allow_list mode the folders and notes the token can reach, each with its
// own permissions; in deny_list mode the ones it cannot reach, without
// permissions. A folder entry covers the folder's whole subtree, including
// what is created there later.
//
// A target in the trash keeps its entries (they apply again on restore).
// Deleting a target for good removes its entries through the cascades
// below, inside the database: the service that deletes folders or notes
// for good must write the audit event (actor "system") for every entry
// removed this way, read before the delete, as the database records none.
export const apiTokenEntries = pgTable(
  "api_token_entries",
  {
    id: idColumn(),
    tokenId: uuid("token_id").notNull(),
    // The token's mode, copied and held equal by the foreign key below, so
    // the permissions rule can depend on it. A token's mode can only change
    // while it has no entries (the foreign key refuses it otherwise).
    tokenAccessMode: text("token_access_mode").$type<ApiTokenAccessMode>().notNull(),
    targetKind: text("target_kind").$type<ApiTokenEntryTargetKind>().notNull(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
    permissions: text("permissions").array().$type<ApiTokenPermission[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Deleting the token deletes its entries.
    foreignKey({
      name: "api_token_entries_token_fk",
      columns: [table.tokenId, table.tokenAccessMode],
      foreignColumns: [apiTokens.id, apiTokens.accessMode],
    }).onDelete("cascade"),
    // Each target at most once per token. Also serve lookups by token_id.
    unique("api_token_entries_token_id_folder_id_unique").on(table.tokenId, table.folderId),
    unique("api_token_entries_token_id_note_id_unique").on(table.tokenId, table.noteId),
    // For the cascades when a folder or note is deleted for good.
    index("api_token_entries_folder_id_idx").on(table.folderId),
    index("api_token_entries_note_id_idx").on(table.noteId),
    check(
      "api_token_entries_target_kind_check",
      sql`${table.targetKind} in (${sql.raw(API_TOKEN_ENTRY_TARGET_KINDS.map((kind) => `'${kind}'`).join(", "))})`,
    ),
    // Exactly the id matching target_kind.
    check(
      "api_token_entries_target_check",
      sql`(${table.targetKind} = 'folder' and ${table.folderId} is not null and ${table.noteId} is null) or (${table.targetKind} = 'note' and ${table.noteId} is not null and ${table.folderId} is null)`,
    ),
    // allow_list: set (a null would pass the tests after it), non-empty, one-dimensional, only permissions the kind of
    // target can carry (a null element is not contained in the list).
    // deny_list: none.
    check(
      "api_token_entries_permissions_check",
      sql`(${table.tokenAccessMode} = 'deny_list' and ${table.permissions} is null) or (${table.tokenAccessMode} = 'allow_list' and ${table.permissions} is not null and cardinality(${table.permissions}) > 0 and array_ndims(${table.permissions}) = 1 and ${table.permissions} <@ (case ${table.targetKind} when 'folder' then ${textArraySql(FOLDER_ENTRY_PERMISSIONS)} else ${textArraySql(NOTE_ENTRY_PERMISSIONS)} end))`,
    ),
  ],
);

export type ApiTokenEntry = typeof apiTokenEntries.$inferSelect;
export type NewApiTokenEntry = typeof apiTokenEntries.$inferInsert;
