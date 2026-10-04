import type { LockedDetails, LockHolder, LockState, LockTargetKind } from "@hexmark/shared";
import type { AccessView } from "../access/access-view";
import { type FolderLock, joinPath } from "../notes/folder-index";

// The lock an item is under: its own, or else that of the nearest folder
// above it (a folder lock covers everything below it, also what is created
// there later; nothing is copied to the items below). Built from lock
// columns and the folder index of the operation; the write checks read the
// rows they lock instead (lock-guard.ts).

export interface OwnLock {
  lockedAt: Date | null;
  lockedByName: string | null;
  lockReason: string | null;
}

export function ownLock(row: OwnLock): FolderLock | null {
  return row.lockedAt
    ? { at: row.lockedAt, byName: row.lockedByName ?? "", reason: row.lockReason }
    : null;
}

// A holder's id is named only when the caller can see that item; its name is
// part of the paths the caller sees anyway.
function holder(view: AccessView, kind: LockTargetKind, id: string, path: string): LockHolder {
  return { kind, id: kind === "note" ? id : view.shownFolderId(id), path };
}

function state(lock: FolderLock, from: LockHolder, inherited: boolean): LockState {
  return { at: lock.at.toISOString(), by: lock.byName, reason: lock.reason, inherited, from };
}

// The nearest locked folder of `folderId` and those above it (the view's
// index); undefined when none is locked.
export function lockedFolder(view: AccessView, folderId: string | null) {
  for (const id of view.index.chain(folderId)) {
    const lock = view.index.get(id)?.lock;
    if (lock) return { id, lock };
  }
  return undefined;
}

// A folder's state with `own` as its own lock (the index may hold the lock
// from before a change).
export function folderStateWith(
  view: AccessView,
  folder: { id: string; parentId: string | null },
  own: FolderLock | null,
): LockState | null {
  const path = view.index.pathOf(folder.id);
  if (own) return state(own, holder(view, "folder", folder.id, path), false);
  const found = lockedFolder(view, folder.parentId);
  if (!found) return null;
  return state(found.lock, holder(view, "folder", found.id, view.index.pathOf(found.id)), true);
}

export function folderLockState(view: AccessView, folderId: string): LockState | null {
  const found = lockedFolder(view, folderId);
  if (!found) return null;
  const from = holder(view, "folder", found.id, view.index.pathOf(found.id));
  return state(found.lock, from, found.id !== folderId);
}

export function noteLockState(
  view: AccessView,
  note: OwnLock & { id: string; title: string; folderId: string | null },
): LockState | null {
  const own = ownLock(note);
  if (own) {
    const path = joinPath(view.index.pathOf(note.folderId), note.title);
    return state(own, holder(view, "note", note.id, path), false);
  }
  const found = lockedFolder(view, note.folderId);
  if (!found) return null;
  return state(found.lock, holder(view, "folder", found.id, view.index.pathOf(found.id)), true);
}

// Details of the 423 refusal for the item holding `lock`.
export function lockedDetails(
  view: AccessView,
  item: { kind: LockTargetKind; id: string; path: string },
  lock: FolderLock,
): LockedDetails {
  return {
    lockedItem: holder(view, item.kind, item.id, item.path),
    lockedAt: lock.at.toISOString(),
    lockedBy: lock.byName,
    reason: lock.reason,
  };
}
