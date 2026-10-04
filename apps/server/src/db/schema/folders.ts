import { FOLDER_NAME_MAX_LENGTH } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { actorChecks, actorColumns } from "./actor-columns";
import { hiddenChecks, hiddenColumns, hiddenIndexes } from "./hidden-columns";
import { idColumn } from "./id-column";
import { lockChecks, lockColumns } from "./lock-columns";
import { trashChecks, trashColumns, trashIndexes } from "./trash-columns";

// Shared with the input schemas (@hexmark/shared), which also refuse "/" in names.
export { FOLDER_NAME_MAX_LENGTH };

const createdBy = actorColumns("created_by");
const updatedBy = actorColumns("updated_by");
const trash = trashColumns();
const lock = lockColumns();
const hide = hiddenColumns();

// The folder tree. Folders are addressed by id; renaming or moving never
// changes it. Cycles are refused by the application when moving; the
// database refuses only the direct one (a folder as its own parent).
export const folders = pgTable(
  "folders",
  {
    id: idColumn(),
    // Null: root level. A folder with subfolders cannot be deleted.
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, {
      onDelete: "restrict",
    }),
    // Part of export paths, hence no "/" and no surrounding white space.
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: createdBy.userId,
    createdByTokenId: createdBy.tokenId,
    createdByName: createdBy.name.notNull(),
    updatedByUserId: updatedBy.userId,
    updatedByTokenId: updatedBy.tokenId,
    updatedByName: updatedBy.name.notNull(),
    // Trash; null while the folder is in use.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Who moved it there and with which batch (trash-columns.ts).
    deletedByUserId: trash.deletedByUserId,
    deletedByTokenId: trash.deletedByTokenId,
    deletedByName: trash.deletedByName,
    trashBatchId: trash.trashBatchId,
    // Locked, together with everything below it (lock-columns.ts); null
    // while the folder is not locked itself.
    lockedAt: lock.lockedAt,
    lockedByUserId: lock.lockedByUserId,
    lockedByTokenId: lock.lockedByTokenId,
    lockedByName: lock.lockedByName,
    lockReason: lock.lockReason,
    // Hidden from agents, together with everything below it
    // (hidden-columns.ts); null while the folder is not hidden itself.
    hiddenAt: hide.hiddenAt,
    hiddenByUserId: hide.hiddenByUserId,
    hiddenByTokenId: hide.hiddenByTokenId,
    hiddenByName: hide.hiddenByName,
    hideReason: hide.hideReason,
  },
  (table) => [
    // Names are unique among the folder's siblings regardless of case,
    // ignoring folders in the trash. Root level separately, as null parents
    // never compare equal in a unique index.
    uniqueIndex("folders_parent_id_name_unique")
      .on(table.parentId, sql`lower(${table.name})`)
      .where(sql`${table.parentId} is not null and ${table.deletedAt} is null`),
    uniqueIndex("folders_root_name_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.parentId} is null and ${table.deletedAt} is null`),
    check(
      "folders_name_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(FOLDER_NAME_MAX_LENGTH))} and strpos(${table.name}, '/') = 0 and ${table.name} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
    check("folders_not_own_parent_check", sql`${table.parentId} <> ${table.id}`),
    ...actorChecks("folders", "created_by", {
      userId: table.createdByUserId,
      tokenId: table.createdByTokenId,
      name: table.createdByName,
    }),
    ...actorChecks("folders", "updated_by", {
      userId: table.updatedByUserId,
      tokenId: table.updatedByTokenId,
      name: table.updatedByName,
    }),
    ...trashChecks("folders", table),
    ...trashIndexes("folders", table),
    ...lockChecks("folders", table),
    ...hiddenChecks("folders", table),
    ...hiddenIndexes("folders", table),
  ],
);

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
