import type { LockedDetails, LockTargetKind } from "./locks";
import { REVISION_REASON_MAX_LENGTH } from "./notes";

// Hidden: agents cannot read a hidden note's content, nor anything below a
// hidden folder (that is invisible to them, as if it did not exist). Agents
// with the hide permission may hide; only people unhide. Agents cannot
// change hidden items either; people read and change them as usual.

// Longest hide reason, in characters (the database checks the same).
export const HIDE_REASON_MAX_LENGTH = REVISION_REASON_MAX_LENGTH;

// The note or folder that is hidden itself.
export interface HiddenHolder {
  kind: LockTargetKind;
  id: string;
  path: string;
}

// The hidden state shown in reads: null when the item is not hidden. Agents
// only ever see items hidden themselves (inherited: false): what lies below
// a hidden folder does not exist for them.
export interface HiddenState {
  at: string;
  // Who hid it: a username or an API token's name.
  by: string;
  reason: string | null;
  // True when a folder above it is hidden.
  inherited: boolean;
  from: HiddenHolder;
}

// Details of 403 hidden: the item that is hidden (a note whose content was
// asked for, or the note or folder an agent tried to change or put
// something into). `locked`: an agent's write that a lock refuses as well
// (unhiding alone would not allow it); null when nothing is locked, left out
// for reads.
export interface HiddenDetails {
  hiddenItem: HiddenHolder;
  // The note's title, for a hidden note.
  title?: string;
  hiddenAt: string;
  hiddenBy: string;
  reason: string | null;
  locked?: LockedDetails | null;
}

// A hidden item as GET /api/notes/v1/hidden lists it (people only).
export interface HiddenItem {
  kind: LockTargetKind;
  id: string;
  path: string;
  hiddenAt: string;
  hiddenBy: string;
  reason: string | null;
  // Folders: the notes and folders below it that are hidden from agents too.
  coveredNotes: number;
  coveredFolders: number;
}

// Answer of hiding or unhiding.
export interface HideResult {
  kind: LockTargetKind;
  id: string;
  path: string;
  // Null after unhiding (unless a folder above is still hidden).
  hidden: HiddenState | null;
  // False when the item was already in that state (nothing written).
  changed: boolean;
  // Only with changed: false, a short English note that nothing was written.
  message?: string;
}
