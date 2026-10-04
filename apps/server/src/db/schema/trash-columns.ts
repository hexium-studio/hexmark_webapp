import { sql } from "drizzle-orm";
import { check, index, type PgColumn, uuid } from "drizzle-orm/pg-core";
import { actorChecks, actorColumns } from "./actor-columns";

// Trash bookkeeping shared by notes and folders, next to their deleted_at:
// who moved the row to the trash (actor triple deleted_by_*) and the batch
// it went with. Deleting a folder trashes its whole subtree as one batch, so
// restoring the folder restores exactly that batch; a note or folder trashed
// on its own forms a batch of one.
//
// Columns: deleted_by_user_id, deleted_by_token_id, deleted_by_name,
// trash_batch_id.
export function trashColumns() {
  const deletedBy = actorColumns("deleted_by");
  return {
    deletedByUserId: deletedBy.userId,
    deletedByTokenId: deletedBy.tokenId,
    deletedByName: deletedBy.name,
    trashBatchId: uuid("trash_batch_id"),
  };
}

interface TrashRefs {
  deletedAt: PgColumn;
  deletedByUserId: PgColumn;
  deletedByTokenId: PgColumn;
  deletedByName: PgColumn;
  trashBatchId: PgColumn;
}

// The actor checks for deleted_by plus the pairing: a row in use has none of
// the trash columns set; a row in the trash has deleted_at, the actor name
// and the batch id (the ids may be null once that user or token is deleted).
export function trashChecks(table: string, t: TrashRefs) {
  const unset = sql`${t.deletedByUserId} is null and ${t.deletedByTokenId} is null and ${t.deletedByName} is null and ${t.trashBatchId} is null`;
  return [
    ...actorChecks(table, "deleted_by", {
      userId: t.deletedByUserId,
      tokenId: t.deletedByTokenId,
      name: t.deletedByName,
    }),
    check(
      `${table}_trash_pairing_check`,
      sql`(${t.deletedAt} is null and ${unset}) or (${t.deletedAt} is not null and ${t.deletedByName} is not null and ${t.trashBatchId} is not null)`,
    ),
  ];
}

// Partial indexes: only rows in the trash, for listing the trash, finding
// what the purge removes and restoring a batch.
export function trashIndexes(table: string, t: TrashRefs) {
  return [
    index(`${table}_deleted_at_idx`).on(t.deletedAt).where(sql`${t.deletedAt} is not null`),
    index(`${table}_trash_batch_id_idx`)
      .on(t.trashBatchId)
      .where(sql`${t.trashBatchId} is not null`),
  ];
}
