import type { LockResult } from "@hexmark/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef, Actor } from "../access/access";
import { chainRefusal, folderRefusal, type Grant, noteRefusal } from "../access/authorize";
import { ownHidden } from "../hidden/hidden-state";
import { isUuid, type NoteRef, resolveNoteRef } from "../notes/addressing";
import { type FolderLock, joinPath } from "../notes/folder-index";
import { lockNote as lockNoteRow } from "../notes/note-store";
import { isFailure, refuse } from "../notes/refusals";
import { missingFolder } from "../trash/in-trash";
import { changeLock, type LockSubject } from "./lock-change";
import { folderStateWith, noteLockState, ownLock } from "./lock-state";

// Locking and unlocking a note or a folder (lock-change.ts decides). A
// folder's lock covers everything below it, also what is created there later.
// Locking is not a change of content: no new version, no revision; the
// audit log records it. Only notes and folders in use can be locked; an
// agent cannot lock a hidden one (it cannot change hidden items at all).

function lockValues(lock: FolderLock | null, actor: Actor) {
  return {
    lockedAt: lock?.at ?? null,
    lockedByUserId: lock ? actor.userId : null,
    lockedByTokenId: lock ? actor.tokenId : null,
    lockedByName: lock?.byName ?? null,
    lockReason: lock?.reason ?? null,
  };
}

const asColumns = (lock: FolderLock | null) => ({
  lockedAt: lock?.at ?? null,
  lockedByName: lock?.byName ?? null,
  lockReason: lock?.reason ?? null,
});

async function findNote(
  tx: Transaction,
  grant: Grant,
  note: NoteRef,
): Promise<LockSubject | Failure> {
  const id = await resolveNoteRef(tx, grant, grant.index, note);
  if (isFailure(id)) return id;
  const row = await lockNoteRow(tx, id);
  if (!row || !grant.view.seesNote(row)) return refuse("not_found");
  const refused = noteRefusal(grant.view, row, "lock");
  if (refused) return refused;
  return {
    kind: "note",
    id: row.id,
    path: joinPath(grant.index.pathOf(row.folderId), row.title),
    title: row.title,
    hidden: ownHidden(row),
    parentId: row.folderId,
    own: ownLock(row),
    recheck: (chain, hidden) =>
      chainRefusal(grant.access.policy, { kind: "note", id: row.id }, chain, hidden, "lock"),
    write: async (writer, lock, { access }) => {
      await writer.update(notes).set(lockValues(lock, access.actor)).where(eq(notes.id, row.id));
    },
    state: (view, own) => noteLockState(view, { ...row, ...asColumns(own) }),
  };
}

async function findFolder(tx: Transaction, grant: Grant, id: string) {
  if (!isUuid(id)) return refuse("folder_not_found");
  const [row] = await tx
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
    .for("update");
  if (!row) return missingFolder(tx, grant, id);
  const refused = folderRefusal(grant.view, row.id, "lock");
  if (refused) return refused;
  const subject: LockSubject = {
    kind: "folder",
    id: row.id,
    path: grant.index.pathOf(row.id),
    hidden: ownHidden(row),
    parentId: row.parentId,
    own: ownLock(row),
    recheck: (chain, hidden) =>
      chainRefusal(grant.access.policy, { kind: "folder" }, [row.id, ...chain], hidden, "lock"),
    write: async (writer, lock, { access }) => {
      await writer
        .update(folders)
        .set(lockValues(lock, access.actor))
        .where(eq(folders.id, row.id));
    },
    state: (view, own) => folderStateWith(view, row, own),
  };
  return subject;
}

type Input = { reason?: string };

export function lockNote(ref: AccessRef, now: Date, note: NoteRef, input: Input) {
  return changeLock({
    ref,
    now,
    action: "note.locked",
    lock: true,
    input: { note, ...input },
    find: (tx, grant) => findNote(tx, grant, note),
  });
}

export function unlockNote(ref: AccessRef, now: Date, note: NoteRef, input: Input) {
  return changeLock({
    ref,
    now,
    action: "note.unlocked",
    lock: false,
    input: { note, ...input },
    find: (tx, grant) => findNote(tx, grant, note),
  });
}

export function lockFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: Input,
): Promise<Outcome<LockResult>> {
  return changeLock({
    ref,
    now,
    action: "folder.locked",
    lock: true,
    input: { id, ...input },
    find: (tx, grant) => findFolder(tx, grant, id),
  });
}

export function unlockFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: Input,
): Promise<Outcome<LockResult>> {
  return changeLock({
    ref,
    now,
    action: "folder.unlocked",
    lock: false,
    input: { id, ...input },
    find: (tx, grant) => findFolder(tx, grant, id),
  });
}
