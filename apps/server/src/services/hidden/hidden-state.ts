import type {
  HiddenDetails,
  HiddenHolder,
  HiddenState,
  LockedDetails,
  LockTargetKind,
} from "@hexmark/shared";
import type { Failure } from "../../lib/outcome";
import type { AccessView } from "../access/access-view";
import { type FolderHidden, joinPath } from "../notes/folder-index";
import { refuse } from "../notes/refusals";

// The hidden mark an item is under: its own, or else that of the nearest
// hidden folder above it (a hidden folder hides everything below it, also
// what is created there later; nothing is copied to the items below). Built
// from hidden columns and the folder index of the operation; the write
// checks read the rows they lock instead (locks/lock-guard.ts). An agent
// never sees an inherited state: what lies below a hidden folder does not
// exist for it (access/policy.ts).

export interface OwnHidden {
  hiddenAt: Date | null;
  hiddenByName: string | null;
  hideReason: string | null;
}

export function ownHidden(row: OwnHidden): FolderHidden | null {
  return row.hiddenAt
    ? { at: row.hiddenAt, byName: row.hiddenByName ?? "", reason: row.hideReason }
    : null;
}

function state(mark: FolderHidden, from: HiddenHolder, inherited: boolean): HiddenState {
  return { at: mark.at.toISOString(), by: mark.byName, reason: mark.reason, inherited, from };
}

// The nearest hidden folder of `folderId` and those above it (the view's
// index); undefined when none is hidden.
export function hiddenFolder(view: AccessView, folderId: string | null) {
  for (const id of view.index.chain(folderId)) {
    const mark = view.index.get(id)?.hidden;
    if (mark) return { id, mark };
  }
  return undefined;
}

function inheritedFrom(view: AccessView, folderId: string | null): HiddenState | null {
  const found = hiddenFolder(view, folderId);
  if (!found) return null;
  const from = { kind: "folder" as const, id: found.id, path: view.index.pathOf(found.id) };
  return state(found.mark, from, true);
}

// A folder's state with `own` as its own mark (the index may hold the mark
// from before a change).
export function folderHiddenStateWith(
  view: AccessView,
  folder: { id: string; parentId: string | null },
  own: FolderHidden | null,
): HiddenState | null {
  if (!own) return inheritedFrom(view, folder.parentId);
  return state(own, { kind: "folder", id: folder.id, path: view.index.pathOf(folder.id) }, false);
}

export function folderHiddenState(view: AccessView, folderId: string): HiddenState | null {
  const own = view.index.get(folderId)?.hidden ?? null;
  const parentId = view.index.get(folderId)?.parentId ?? null;
  return folderHiddenStateWith(view, { id: folderId, parentId }, own);
}

export function noteHiddenState(
  view: AccessView,
  note: OwnHidden & { id: string; title: string; folderId: string | null },
): HiddenState | null {
  const own = ownHidden(note);
  if (!own) return inheritedFrom(view, note.folderId);
  const path = joinPath(view.index.pathOf(note.folderId), note.title);
  return state(own, { kind: "note", id: note.id, path }, false);
}

// 403 hidden for the item holding `mark`: the content of a hidden note
// asked for, or an agent's write on (or into) a hidden item. `locked`: the
// lock refusal the same write has as well, or null; left out for reads.
export function hiddenRefusal(
  item: { kind: LockTargetKind; id: string; path: string; title?: string },
  mark: FolderHidden,
  locked?: Failure | null,
): Failure {
  const { title, ...holder } = item;
  const details: HiddenDetails = {
    hiddenItem: holder,
    ...(title === undefined ? {} : { title }),
    hiddenAt: mark.at.toISOString(),
    hiddenBy: mark.byName,
    reason: mark.reason,
    ...(locked === undefined
      ? {}
      : { locked: locked ? (locked.details as unknown as LockedDetails) : null }),
  };
  return refuse("hidden", { ...details });
}
