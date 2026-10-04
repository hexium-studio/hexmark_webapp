import type { RestoredFolder } from "@hexmark/shared";
import { eq, sql } from "drizzle-orm";
import { folders } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize } from "../access/authorize";
import { recordAccessEvent, recordAccessEvents } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { isUuid } from "../notes/addressing";
import { loadFolderIndex } from "../notes/folder-index";
import { guardFolderName } from "../notes/folder-name";
import { serializeFolderTree } from "../notes/folders";
import { isFailure, refuse } from "../notes/refusals";
import { batchItemDetails, batchMemberEvents, folderItems, markedNoteItems } from "./batch-events";
import { lockRestoreTarget } from "./trash-note";
import { inTrashScope, markNotes, OUT_OF_TRASH, trashScope } from "./trash-store";

// A folder back from the trash with the batch it was deleted with: its
// subfolders and notes come back as they were (each note with a "restored"
// revision). Items deleted on their own before stay in the trash. Only the
// folder a batch was deleted with can be restored this way; one inside it
// is refused with parent_in_trash, as its parent is in the trash too. When
// a folder in use holds its name now, name_taken names that folder
// (folder-name.ts), so the client can rename it or this one first. The
// answer counts the subfolders (not the folder itself) and notes that came
// back; the audit log gets the folder's event with the items of the batch
// and one event per item (batch-events.ts).

export function restoreFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: { reason?: string },
): Promise<Outcome<RestoredFolder>> {
  return runAudited({ ref, action: "folder.restored", input: { id, ...input } }, async (tx) => {
    const grant = await authorize(tx, ref, now, "delete");
    if (isFailure(grant)) return grant;
    if (!isUuid(id)) return refuse("folder_not_found");
    await serializeFolderTree(tx);
    const [row] = await tx.select().from(folders).where(eq(folders.id, id)).for("update");
    if (!row || !inTrashScope(await trashScope(tx, grant), row.id)) {
      return refuse("folder_not_found");
    }
    const batchId = row.trashBatchId;
    if (row.deletedAt === null || batchId === null) return refuse("folder_not_deleted");
    // Decided on the folder itself (above): for a token limited to folders
    // its parent may lie outside them.
    const refused = await lockRestoreTarget(tx, grant, row.parentId, false);
    if (refused) return refused;
    const restored = await guardFolderName(tx, row, (savepoint) =>
      savepoint
        .update(folders)
        .set(OUT_OF_TRASH)
        .where(eq(folders.trashBatchId, batchId))
        .returning({ id: folders.id }),
    );
    if (isFailure(restored)) return restored;
    const marked = await markNotes(
      tx,
      sql`trash_batch_id = ${batchId}::uuid`,
      OUT_OF_TRASH,
      "restored",
      input.reason,
      grant.access.actor,
      now,
    );
    const index = await loadFolderIndex(tx);
    const path = index.pathOf(row.id);
    const members = {
      folders: folderItems(
        restored.map((folder) => folder.id),
        row.id,
        index,
      ),
      notes: markedNoteItems(marked, index),
    };
    const counts = { restoredSubfolders: members.folders.length, restoredNotes: marked.length };
    const reason = input.reason ?? null;
    await recordAccessEvent(
      tx,
      grant.access,
      {
        action: "folder.restored",
        target: { kind: "folder", id: row.id, label: path },
        reason,
        details: { batchId, ...counts, ...batchItemDetails(members) },
      },
      now,
    );
    const root = { id: row.id, path };
    const events = batchMemberEvents("restored", root, members, { batchId, reason });
    await recordAccessEvents(tx, grant.access, events, now);
    return { id: row.id, name: row.name, path, batchId, ...counts } satisfies RestoredFolder;
  });
}
