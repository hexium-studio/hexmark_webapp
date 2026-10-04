import type { PurgedItems } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";

// Deleting from the trash for good: the one way rows of notes and folders
// are removed, shared by the purge job (purge.ts) and the deletions people
// make (trash-delete.ts). A note goes with its revisions and sections
// (cascade). Folders go children first (parent_id refuses to lose a parent
// that still has children), so a folder whose subtree still holds something
// - an item deleted later and not due yet, in the purge - stays until that
// is gone too.

// One note or folder deleted for good, as it was: for the audit log.
export interface RemovedItem extends Record<string, unknown> {
  id: string;
  // The note's title or the folder's name.
  name: string;
  // The note's folder or the folder's parent.
  parent_id: string | null;
  trash_batch_id: string | null;
}

export interface Removed {
  notes: RemovedItem[];
  folders: RemovedItem[];
}

export function removedCounts(removed: Removed): PurgedItems {
  return { notes: removed.notes.length, folders: removed.folders.length };
}

export interface RemovalFilter {
  // Only items deleted at or before this time (the purge's cutoff).
  before?: Date;
  // Only these notes, and only notes in these folders and these folders.
  noteIds?: readonly string[];
  folderIds?: readonly string[];
}

function conditions(filter: RemovalFilter, alias: "n" | "f") {
  const parts = [sql.raw(`${alias}.deleted_at is not null`)];
  if (filter.before) {
    parts.push(sql`${sql.raw(alias)}.deleted_at <= ${filter.before.toISOString()}::timestamptz`);
  }
  return parts;
}

function anyOf(column: string, ids: readonly string[]) {
  return sql`${sql.raw(column)} = any(${sql.param([...ids])}::uuid[])`;
}

export async function removeFromTrash(tx: Transaction, filter: RemovalFilter): Promise<Removed> {
  const noteParts = conditions(filter, "n");
  const { noteIds, folderIds } = filter;
  if (noteIds || folderIds) {
    const targets = [
      ...(noteIds ? [anyOf("n.id", noteIds)] : []),
      ...(folderIds ? [anyOf("n.folder_id", folderIds)] : []),
    ];
    noteParts.push(sql`(${sql.join(targets, sql` or `)})`);
  }
  const removedNotes = await tx.execute<RemovedItem>(sql`
    delete from notes n where ${sql.join(noteParts, sql` and `)}
    returning n.id, n.title as name, n.folder_id as parent_id, n.trash_batch_id
  `);
  const removedFolders: RemovedItem[] = [];
  if (noteIds && !folderIds) return { notes: [...removedNotes], folders: [] };
  const folderParts = conditions(filter, "f");
  if (folderIds) folderParts.push(anyOf("f.id", folderIds));
  folderParts.push(sql`not exists (select 1 from folders c where c.parent_id = f.id)`);
  folderParts.push(sql`not exists (select 1 from notes m where m.folder_id = f.id)`);
  // One level of leaves per round, until no folder is left that may go.
  for (;;) {
    const round = await tx.execute<RemovedItem>(sql`
      delete from folders f where ${sql.join(folderParts, sql` and `)}
      returning f.id, f.name, f.parent_id, f.trash_batch_id
    `);
    if (round.length === 0) break;
    removedFolders.push(...round);
  }
  return { notes: [...removedNotes], folders: removedFolders };
}
