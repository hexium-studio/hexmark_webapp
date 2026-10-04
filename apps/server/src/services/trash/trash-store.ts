import type { InTrashDetails, NoteChange } from "@hexmark/shared";
import { type SQL, sql } from "drizzle-orm";
import { trashRetentionDays } from "../../config/trash";
import type { Transaction } from "../../db/client";
import type { Actor } from "../access/access";
import { purgeAt } from "./retention";

// The trash columns of notes and folders (deleted_at, deleted_by_*,
// trash_batch_id; db/schema/trash-columns.ts) and what every trash
// operation shares: the revisions written when notes go there or come
// back. Who may see what is in the trash: the access view over all folders
// (Grant.trashView, services/access).

export interface TrashMark {
  deletedAt: Date | null;
  deletedByUserId: string | null;
  deletedByTokenId: string | null;
  deletedByName: string | null;
  trashBatchId: string | null;
}

// In the trash since `now`, deleted by `actor` with batch `batchId`.
export function trashMark(actor: Actor, now: Date, batchId: string): TrashMark {
  return {
    deletedAt: now,
    deletedByUserId: actor.userId,
    deletedByTokenId: actor.tokenId,
    deletedByName: actor.name,
    trashBatchId: batchId,
  };
}

// Out of the trash: every trash column cleared together (the pairing check).
export const OUT_OF_TRASH: TrashMark = {
  deletedAt: null,
  deletedByUserId: null,
  deletedByTokenId: null,
  deletedByName: null,
  trashBatchId: null,
};

export function inTrashDetails(deletedAt: Date): InTrashDetails {
  return {
    deletedAt: deletedAt.toISOString(),
    purgeAt: purgeAt(deletedAt, trashRetentionDays).toISOString(),
  };
}

// A note markNotes changed: its new version, title and folder.
export interface MarkedNote {
  id: string;
  version: number;
  title: string;
  folderId: string | null;
}

// Moves the notes matching `where` into the trash or out of it, each as a new
// version with its revision (`change`, reason, actor), in one statement: the
// snapshot is copied in the database, so bodies never travel. Title and body
// stay, so the sections stay as well. Returns the notes changed.
export async function markNotes(
  tx: Transaction,
  where: SQL,
  mark: TrashMark,
  change: Extract<NoteChange, "deleted" | "restored">,
  reason: string | undefined,
  actor: Actor,
  now: Date,
): Promise<MarkedNote[]> {
  const at = now.toISOString();
  const rows = await tx.execute<{
    note_id: string;
    version: number;
    title: string;
    folder_id: string | null;
  }>(sql`
    with changed as (
      update notes set
        version = version + 1,
        updated_at = ${at}::timestamptz,
        updated_by_user_id = ${actor.userId}::uuid,
        updated_by_token_id = ${actor.tokenId}::uuid,
        updated_by_name = ${actor.name},
        deleted_at = ${mark.deletedAt?.toISOString() ?? null}::timestamptz,
        deleted_by_user_id = ${mark.deletedByUserId}::uuid,
        deleted_by_token_id = ${mark.deletedByTokenId}::uuid,
        deleted_by_name = ${mark.deletedByName},
        trash_batch_id = ${mark.trashBatchId}::uuid
      where ${where}
      returning id, version, title, body, folder_id, metadata
    )
    insert into note_revisions (note_id, version, title, body, folder_id, metadata, change,
      reason, actor_user_id, actor_token_id, actor_name, created_at)
    select id, version, title, body, folder_id, metadata, ${change}, ${reason ?? null},
      ${actor.userId}::uuid, ${actor.tokenId}::uuid, ${actor.name}, ${at}::timestamptz
    from changed
    returning note_id, version, title, folder_id
  `);
  return rows.map((row) => ({
    id: row.note_id,
    version: Number(row.version),
    title: row.title,
    folderId: row.folder_id,
  }));
}
