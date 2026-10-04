import type { NoteWriteResult, TrashedNote } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { trashRetentionDays } from "../../config/trash";
import type { Transaction } from "../../db/client";
import { folders } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import { uuidv7 } from "../../lib/uuid";
import type { AccessRef } from "../access/access";
import { chainRefusal, type Grant, placeRefusal } from "../access/authorize";
import { folderChainRefusal } from "../locks/lock-guard";
import type { NoteRef } from "../notes/addressing";
import { writeNote } from "../notes/note-write";
import { refuse } from "../notes/refusals";
import { purgeAt } from "./retention";
import { OUT_OF_TRASH, trashMark } from "./trash-store";

// A single note into the trash and back. Each is a new version of the note
// with its revision ("deleted", "restored"), written like every other note
// change (services/notes/note-write.ts): on the locked row, the deletion
// checked against expected_version.

// Into the trash, as a batch of its own: hidden from every read, search and
// listing; its title is free again in its folder.
export async function trashNote(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  input: { expectedVersion: number; reason?: string },
): Promise<Outcome<TrashedNote>> {
  const batchId = uuidv7();
  const outcome = await writeNote({
    ref,
    now,
    permission: "delete",
    action: "note.deleted",
    input: { note, ...input },
    note,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    async plan(_row, { grant }) {
      return { change: "deleted", ...trashMark(grant.access.actor, now, batchId) };
    },
  });
  if (!outcome.ok) return outcome;
  const { id, version, path } = outcome.value;
  return {
    ok: true,
    value: {
      kind: "note",
      id,
      version,
      path,
      deletedAt: now.toISOString(),
      purgeAt: purgeAt(now, trashRetentionDays).toISOString(),
      batchId,
    },
  };
}

// The folder something comes back into (null: the root level): in use and
// kept so until the transaction ends (share lock). A folder in the trash is
// refused with parent_in_trash naming it, when the caller may see it there.
// `requireVisible`: the caller must also hold delete on the folder (a
// restored note); a restored folder is checked on itself instead. An agent
// cannot restore anything into a locked folder.
export async function lockRestoreTarget(
  tx: Transaction,
  grant: Grant,
  folderId: string | null,
  requireVisible = true,
): Promise<Failure | null> {
  if (folderId !== null) {
    const [folder] = await tx
      .select({ deletedAt: folders.deletedAt })
      .from(folders)
      .where(eq(folders.id, folderId))
      .for("share");
    if (!folder) return refuse("folder_not_found");
    if (folder.deletedAt) {
      const view = await grant.trashView();
      if (!view.seesFolder(folderId)) return refuse("folder_not_found");
      return refuse("parent_in_trash", { folderId, path: view.index.pathOf(folderId) });
    }
  }
  return (
    (requireVisible ? placeRefusal(grant.view, folderId, "delete") : null) ??
    folderChainRefusal(tx, grant, folderId, grant.view, (chain, hidden) =>
      requireVisible
        ? chainRefusal(grant.access.policy, { kind: "place" }, chain, hidden, "delete")
        : null,
    )
  );
}

// Back from the trash: into the folder it was deleted from, or into
// `folderId` (null: the root level) when given, under `title` when given.
// Refused with parent_in_trash when that folder is in the trash itself, and
// with title_taken when a note there holds the title now.
export function restoreNote(
  ref: AccessRef,
  now: Date,
  id: string,
  input: { folderId?: string | null; title?: string; reason?: string },
): Promise<Outcome<NoteWriteResult>> {
  return writeNote({
    ref,
    now,
    permission: "delete",
    action: "note.restored",
    input: { note: { id }, ...input },
    note: { id },
    expectedVersion: null,
    reason: input.reason,
    inTrash: true,
    async plan(row, { tx, grant }) {
      const target = input.folderId === undefined ? row.folderId : input.folderId;
      const refused = await lockRestoreTarget(tx, grant, target);
      if (refused) return refused;
      const title = input.title ?? row.title;
      return { change: "restored", folderId: target, title, ...OUT_OF_TRASH };
    },
  });
}
