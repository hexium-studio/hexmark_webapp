import { REVISION_REASON_MAX_LENGTH } from "./notes";

// Locks: a locked note or folder (with everything below it, also what is
// created there later) cannot be changed by agents. Agents with the lock
// permission may lock; only people unlock, and people may still change
// locked items. Reads are not affected.

// Longest lock reason, in characters (the database checks the same).
export const LOCK_REASON_MAX_LENGTH = REVISION_REASON_MAX_LENGTH;

export type LockTargetKind = "note" | "folder";

// The note or folder that holds a lock. `id` is null when that folder is
// outside what the token can reach (its name still shows in the path).
export interface LockHolder {
  kind: LockTargetKind;
  id: string | null;
  path: string;
}

// The lock state shown in reads: null when the item is not locked.
export interface LockState {
  at: string;
  // Who locked it: a username or an API token's name.
  by: string;
  reason: string | null;
  // True when a folder above it holds the lock.
  inherited: boolean;
  from: LockHolder;
}

// Details of 423 locked. `alreadyLocked`: only when an agent tried to lock
// what is locked already (by a folder above it): nothing needs to be done.
export interface LockedDetails {
  lockedItem: LockHolder;
  lockedAt: string;
  lockedBy: string;
  reason: string | null;
  alreadyLocked?: true;
}

// A locked item as GET /api/notes/v1/locked lists it.
export interface LockedItem {
  kind: LockTargetKind;
  id: string;
  path: string;
  lockedAt: string;
  lockedBy: string;
  reason: string | null;
  // Folders: the notes and folders below it that the lock covers too.
  coveredNotes: number;
  coveredFolders: number;
}

// Answer of locking or unlocking.
export interface LockResult {
  kind: LockTargetKind;
  id: string;
  path: string;
  // Null after unlocking.
  locked: LockState | null;
  // False when the item was already in that state (nothing written).
  changed: boolean;
  // Only with changed: false, a short English note that nothing was written.
  message?: string;
}
