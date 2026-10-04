import type { TrashedFolder } from "@hexmark/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { trashRetentionDays } from "../../config/trash";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import { uuidv7 } from "../../lib/uuid";
import type { AccessRef } from "../access/access";
import { AccessView } from "../access/access-view";
import { authorize, chainRefusal, folderRefusal } from "../access/authorize";
import { recordAccessEvent, recordAccessEvents } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { folderChainRefusal } from "../locks/lock-guard";
import {
  hiddenContentRefusal,
  subtreeHiddenRefusal,
  subtreeLockRefusal,
} from "../locks/subtree-guard";
import { isUuid } from "../notes/addressing";
import { folderSubtreeIds, loadFolderIndex } from "../notes/folder-index";
import { serializeFolderTree } from "../notes/folders";
import { isFailure, refuse } from "../notes/refusals";
import { batchItemDetails, batchMemberEvents, folderItems, markedNoteItems } from "./batch-events";
import { missingFolder } from "./in-trash";
import { purgeAt } from "./retention";
import { markNotes, trashMark } from "./trash-store";

// A folder into the trash, with everything in it, as one batch: the folder,
// its subfolders and their notes get the same batch id, and restoring the
// folder restores exactly that batch (trash-restore-folder.ts). What was in
// the trash already keeps its own batch. Every note taken along gets a new
// version with a "deleted" revision carrying the reason. The audit log gets
// the folder's event with the items of the batch and one event per item
// (batch-events.ts). An agent cannot take along what is hidden, what it
// cannot see or what is locked (locks/subtree-guard.ts).

// Locks the folder's subtree (folders in use) for update and returns its ids.
// Under the tree lock no folder moves in or out, but a subfolder may still be
// created inside meanwhile (its creator holds a share lock on the parent), so
// the subtree is read again after each round of locks until nothing new
// turns up. Once every folder is locked, no note can be created in or moved
// into them before this transaction ends.
async function lockSubtree(tx: Transaction, rootId: string): Promise<string[]> {
  const locked = new Set<string>();
  for (;;) {
    const ids = await folderSubtreeIds(tx, [rootId]);
    const fresh = ids.filter((id) => !locked.has(id)).sort();
    if (fresh.length === 0) return ids;
    await tx
      .select({ id: folders.id })
      .from(folders)
      .where(inArray(folders.id, fresh))
      .orderBy(folders.id)
      .for("update");
    for (const id of fresh) locked.add(id);
  }
}

export function trashFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: { reason?: string },
): Promise<Outcome<TrashedFolder>> {
  return runAudited({ ref, action: "folder.deleted", input: { id, ...input } }, async (tx) => {
    const grant = await authorize(tx, ref, now, "delete");
    if (isFailure(grant)) return grant;
    if (!isUuid(id)) return refuse("folder_not_found");
    await serializeFolderTree(tx);
    const [row] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
      .for("update");
    if (!row) return missingFolder(tx, grant, id);
    const refused =
      folderRefusal(grant.view, row.id, "delete") ??
      (await folderChainRefusal(tx, grant, id, grant.view, (chain, hidden) =>
        chainRefusal(grant.access.policy, { kind: "folder" }, chain, hidden, "delete"),
      ));
    if (refused) return refused;
    const ids = await lockSubtree(tx, id);
    // The tree as it is under the tree lock, for what the batch takes along.
    const view = new AccessView(grant.access.policy, await loadFolderIndex(tx));
    const liveNotes = sql`${notes.folderId} = any(${sql.param(ids)}::uuid[]) and ${notes.deletedAt} is null`;
    // Hiding a note takes a share lock on its folders (hide-change.ts), so
    // with the subtree locked its hidden marks are current here.
    const unseen =
      (await subtreeHiddenRefusal(tx, grant, view, ids, liveNotes)) ??
      (await hiddenContentRefusal(tx, grant, view, ids, liveNotes));
    if (unseen) return unseen;
    // Paths as they were, before the folders leave the index of folders in use.
    const { index } = view;
    const path = index.pathOf(id);
    const { actor } = grant.access;
    const batchId = uuidv7();
    const mark = trashMark(actor, now, batchId);
    await tx
      .update(folders)
      .set(mark)
      .where(and(inArray(folders.id, ids), isNull(folders.deletedAt)));
    const marked = await markNotes(
      tx,
      sql`folder_id = any(${sql.param(ids)}::uuid[]) and deleted_at is null`,
      mark,
      "deleted",
      input.reason,
      actor,
      now,
    );
    const locked = await subtreeLockRefusal(
      tx,
      grant,
      view,
      ids,
      sql`${notes.trashBatchId} = ${batchId}::uuid`,
    );
    if (locked) return locked;
    const folderCount = ids.length - 1;
    const noteCount = marked.length;
    const members = {
      folders: folderItems(ids, id, index),
      notes: markedNoteItems(marked, index),
    };
    const reason = input.reason ?? null;
    await recordAccessEvent(
      tx,
      grant.access,
      {
        action: "folder.deleted",
        target: { kind: "folder", id, label: path },
        reason,
        details: { batchId, folderCount, noteCount, ...batchItemDetails(members) },
      },
      now,
    );
    const root = { id, path };
    const events = batchMemberEvents("deleted", root, members, { batchId, reason });
    await recordAccessEvents(tx, grant.access, events, now);
    return {
      kind: "folder",
      id,
      path,
      deletedAt: now.toISOString(),
      purgeAt: purgeAt(now, trashRetentionDays).toISOString(),
      batchId,
      folderCount,
      noteCount,
    } satisfies TrashedFolder;
  });
}
