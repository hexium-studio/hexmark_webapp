import type { AuditAction, PurgedItems } from "@hexmark/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize, canSeeFolder, type Grant } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { actorOfAccess, sourceOf } from "../audit/actor";
import { runAudited } from "../audit/audited";
import { isUuid } from "../notes/addressing";
import { folderSubtreeIds } from "../notes/folder-index";
import { serializeFolderTree } from "../notes/folders";
import { isFailure, refuse } from "../notes/refusals";
import { reauthenticationRefusal } from "../sessions/reauthentication";
import { lockTrashRemoval } from "./purge";
import { indexBeforeRemoval, type RemovalLog, recordRemovals } from "./removal-events";
import { type Removed, removedCounts, removeFromTrash } from "./trash-remove";
import { inTrashScope, trashScope } from "./trash-store";

// Deleting from the trash for good before the purge would: a note, a folder
// with everything of it in the trash, or the whole trash. Only people do
// this, signed in (a session), never an agent's API token: agents can move
// things to the trash and restore them, and what they delete stays
// restorable until the purge. Emptying the whole trash is for
// administrators. Like creating an API token, all of it is a sensitive
// action: the password must have been re-entered in the session recently.
// The rules are decided here, on the session row locked by authorize, not
// by the endpoints. Every note and folder removed is logged on its own
// (removal-events.ts).

function forGood(
  ref: AccessRef,
  now: Date,
  attempt: { action: AuditAction; input?: unknown; via: RemovalLog["via"] },
  run: (tx: Transaction, grant: Grant) => Promise<Removed | Failure>,
  adminOnly = false,
): Promise<Outcome<PurgedItems>> {
  return runAudited({ ref, ...attempt }, async (tx) => {
    const grant = await authorize(tx, ref, now, "delete");
    if (isFailure(grant)) return grant;
    if (grant.access.ref.kind !== "session") {
      return refuse("forbidden", { reason: "session_required" });
    }
    if (adminOnly && grant.access.role !== "admin") {
      return refuse("forbidden", { reason: "admin_required" });
    }
    const stale = reauthenticationRefusal(grant.access.reauthenticatedAt, now);
    if (stale) return stale;
    const index = await indexBeforeRemoval(tx);
    const removed = await run(tx, grant);
    if (isFailure(removed)) return removed;
    const log: RemovalLog = {
      actor: actorOfAccess(grant.access),
      source: sourceOf(grant.access.ref),
      kind: "deleted_permanently",
      via: attempt.via,
    };
    const runId = await recordRemovals(tx, index, removed, log, now);
    const counts = removedCounts(removed);
    if (attempt.via === "empty_trash") {
      const details = { runId, ...counts };
      await recordAccessEvent(tx, grant.access, { action: "trash.emptied", details }, now);
    }
    return counts;
  });
}

export function deleteNoteForGood(ref: AccessRef, now: Date, id: string) {
  const attempt = { action: "note.deleted_permanently", input: { id }, via: "note" } as const;
  return forGood(ref, now, attempt, async (tx, grant) => {
    if (!isUuid(id)) return refuse("not_found");
    const [row] = await tx
      .select({ folderId: notes.folderId, deletedAt: notes.deletedAt })
      .from(notes)
      .where(eq(notes.id, id))
      .for("update");
    if (!row) return refuse("not_found");
    if (row.deletedAt === null) {
      return canSeeFolder(grant, row.folderId) ? refuse("note_not_deleted") : refuse("not_found");
    }
    if (!inTrashScope(await trashScope(tx, grant), row.folderId)) return refuse("not_found");
    return removeFromTrash(tx, { noteIds: [id] });
  });
}

// The folder and everything below it, all of which is in the trash: what
// went with it and what was deleted inside it earlier.
export function deleteFolderForGood(ref: AccessRef, now: Date, id: string) {
  const attempt = { action: "folder.deleted_permanently", input: { id }, via: "folder" } as const;
  return forGood(ref, now, attempt, async (tx, grant) => {
    if (!isUuid(id)) return refuse("folder_not_found");
    await serializeFolderTree(tx);
    const [row] = await tx
      .select({ deletedAt: folders.deletedAt })
      .from(folders)
      .where(eq(folders.id, id))
      .for("update");
    if (!row || !inTrashScope(await trashScope(tx, grant), id)) return refuse("folder_not_found");
    if (row.deletedAt === null) return refuse("folder_not_deleted");
    const ids = await folderSubtreeIds(tx, [id], true);
    const removed = await removeFromTrash(tx, { folderIds: ids });
    const [left] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, id), isNotNull(folders.deletedAt)));
    // Something below it is in use after all: keep everything as it was.
    return left ? refuse("folder_not_empty") : removed;
  });
}

// Everything in the trash, at once.
export function emptyTrash(ref: AccessRef, now: Date) {
  const attempt = { action: "trash.emptied", via: "empty_trash" } as const;
  return forGood(
    ref,
    now,
    attempt,
    async (tx) => {
      await lockTrashRemoval(tx, true);
      return removeFromTrash(tx, {});
    },
    true,
  );
}
