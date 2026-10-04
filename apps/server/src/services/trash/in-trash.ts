import type { BatchRootDetails, FolderInTrashDetails, NoteInTrashDetails } from "@hexmark/shared";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import type { Grant } from "../access/authorize";
import { type FolderIndex, joinPath, loadFolderIndex } from "../notes/folder-index";
import { refuse } from "../notes/refusals";
import { inTrashDetails, inTrashScope, trashScope } from "./trash-store";

// A note or folder named by its id that is not in use may be in the trash. A
// caller who may see it there learns so (in_trash, folder_in_trash, with
// when it will be purged) instead of not_found, and can restore it; anyone
// else gets not_found (folder_not_found). Both name where it was and, when
// it went with a folder above it, that folder (batchRootId, batchRootPath):
// restore_folder takes its id to bring the whole batch back.

// The folder a batch was deleted with: the one folder of the batch whose
// parent is not in the same batch. None for a note deleted on its own.
async function batchRootId(tx: Transaction, batchId: string): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select f.id from folders f left join folders p on p.id = f.parent_id
    where f.trash_batch_id = ${batchId}::uuid
      and (p.id is null or p.trash_batch_id is distinct from f.trash_batch_id)
    limit 1
  `);
  return row?.id ?? null;
}

// The batch root, unless it is `itemId` itself or lies outside the scope.
async function batchRootDetails(
  tx: Transaction,
  scope: ReadonlySet<string> | null,
  index: FolderIndex,
  batchId: string,
  itemId: string,
): Promise<BatchRootDetails> {
  const rootId = await batchRootId(tx, batchId);
  if (rootId === null || rootId === itemId || !inTrashScope(scope, rootId)) return {};
  return { batchRootId: rootId, batchRootPath: index.pathOf(rootId) };
}

export async function inTrashRefusal(
  tx: Transaction,
  grant: Grant,
  id: string,
): Promise<Failure | null> {
  const [row] = await tx
    .select({
      folderId: notes.folderId,
      title: notes.title,
      deletedAt: notes.deletedAt,
      batchId: notes.trashBatchId,
    })
    .from(notes)
    .where(and(eq(notes.id, id), isNotNull(notes.deletedAt)));
  if (!row?.deletedAt || !row.batchId) return null;
  const scope = await trashScope(tx, grant);
  if (!inTrashScope(scope, row.folderId)) return null;
  const index = await loadFolderIndex(tx, true);
  const details: NoteInTrashDetails = {
    ...inTrashDetails(row.deletedAt),
    batchId: row.batchId,
    path: joinPath(index.pathOf(row.folderId), row.title),
    ...(await batchRootDetails(tx, scope, index, row.batchId, id)),
  };
  return refuse("in_trash", { ...details });
}

// The answer for a folder id that names no folder in use the caller may
// see: folder_in_trash when the folder is in the trash within the caller's
// folders, folder_not_found otherwise. Every operation that takes a folder
// in use by its id refuses through here. `id` must be a UUID (checked by
// the caller's input schema or isUuid).
export async function missingFolder(tx: Transaction, grant: Grant, id: string): Promise<Failure> {
  const [row] = await tx
    .select({ deletedAt: folders.deletedAt, batchId: folders.trashBatchId })
    .from(folders)
    .where(and(eq(folders.id, id), isNotNull(folders.deletedAt)));
  if (!row?.deletedAt || !row.batchId) return refuse("folder_not_found");
  const scope = await trashScope(tx, grant);
  if (!inTrashScope(scope, id)) return refuse("folder_not_found");
  const index = await loadFolderIndex(tx, true);
  const details: FolderInTrashDetails = {
    folderId: id,
    path: index.pathOf(id),
    ...inTrashDetails(row.deletedAt),
    batchId: row.batchId,
    ...(await batchRootDetails(tx, scope, index, row.batchId, id)),
  };
  return refuse("folder_in_trash", { ...details });
}
