import type { NotePermission } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import type { AccessView } from "../access/access-view";
import { chainRefusal, type Grant } from "../access/authorize";
import type { HiddenFolders } from "../access/policy";
import { hiddenRefusal, type OwnHidden, ownHidden } from "../hidden/hidden-state";
import { type FolderLock, joinPath } from "../notes/folder-index";
import { refuse } from "../notes/refusals";
import { lockedDetails, type OwnLock, ownLock } from "./lock-state";

// The rules for an agent's writes beyond its permissions: an agent (an API
// token) cannot change, move, rename, delete, restore, lock or create inside
// a locked or a hidden note or folder; people can. Decided inside the
// write's transaction on rows it locks: the note's own row (locked for
// update by the write) and the folders above it, read here with a share
// lock, so a lock or hidden mark set at the same moment either comes first
// and refuses the write, or waits for it to end. The permission and
// visibility are decided again on the same folder rows (a folder above may
// have moved, or been hidden, since the operation's folder index was read).
//
// Locked and hidden are checked separately. When both apply, the answer is
// hidden (403) and carries the lock refusal's details as `locked`: hiding is
// the stronger mark (agents cannot read the content either), and an agent
// learns that a person unhiding it would not be enough.

export function isAgent(grant: Grant): boolean {
  return grant.access.ref.kind === "token";
}

export function lockedRefusal(
  view: AccessView,
  item: { kind: "note" | "folder"; id: string; path: string },
  lock: FolderLock,
): Failure {
  return refuse("locked", { ...lockedDetails(view, item, lock) });
}

interface ChainRow extends OwnLock, OwnHidden {
  id: string;
  parentId: string | null;
  name: string;
}

// `folderId` and the folders above it as they are now, nearest first, each
// row locked for share: a move, rename, lock or hide of one of them waits
// for this transaction, and one that came first is what is read here.
export async function lockedChain(tx: Transaction, folderId: string | null): Promise<ChainRow[]> {
  const rows: ChainRow[] = [];
  for (let id = folderId; id !== null && !rows.some((row) => row.id === id); ) {
    const [row] = await tx
      .select({
        id: folders.id,
        parentId: folders.parentId,
        name: folders.name,
        lockedAt: folders.lockedAt,
        lockedByName: folders.lockedByName,
        lockReason: folders.lockReason,
        hiddenAt: folders.hiddenAt,
        hiddenByName: folders.hiddenByName,
        hideReason: folders.hideReason,
      })
      .from(folders)
      .where(eq(folders.id, id))
      .for("share");
    if (!row) break;
    rows.push(row);
    id = row.parentId;
  }
  return rows;
}

// The hidden folders of a locked chain.
export function hiddenOf(rows: readonly ChainRow[]): HiddenFolders {
  return new Set(rows.filter((row) => row.hiddenAt !== null).map((row) => row.id));
}

// A check of the permission on the chain as locked (authorize.ts,
// chainRefusal): the decision a write stands on.
export type ChainCheck = (chain: readonly string[], hidden: HiddenFolders) => Failure | null;

const pathAt = (rows: readonly ChainRow[], index: number) =>
  rows
    .slice(index)
    .map((entry) => entry.name)
    .reverse()
    .join("/");

// The nearest locked folder of a locked chain refuses, with its path as
// the chain gives it.
function chainLockRefusal(rows: readonly ChainRow[], view: AccessView): Failure | null {
  for (const [index, row] of rows.entries()) {
    const lock = ownLock(row);
    if (lock)
      return lockedRefusal(view, { kind: "folder", id: row.id, path: pathAt(rows, index) }, lock);
  }
  return null;
}

// For an agent: the chain from `folderId` locked (lockedChain), the
// permission decided again on it (`recheck`), then the folder itself - the
// one acted on, or the one something is put into - when it is hidden, then
// the nearest locked folder in it. Null for a person, who is neither
// limited by entries nor by locks or hidden marks.
export async function folderChainRefusal(
  tx: Transaction,
  grant: Grant,
  folderId: string | null,
  view: AccessView = grant.view,
  recheck?: ChainCheck,
): Promise<Failure | null> {
  if (!isAgent(grant)) return null;
  const rows = await lockedChain(tx, folderId);
  const refused = recheck?.(
    rows.map((row) => row.id),
    hiddenOf(rows),
  );
  if (refused) return refused;
  const locked = chainLockRefusal(rows, view);
  const [first] = rows;
  const mark = first ? ownHidden(first) : null;
  if (!first || !mark) return locked;
  return hiddenRefusal({ kind: "folder", id: first.id, path: pathAt(rows, 0) }, mark, locked);
}

// A note the write has locked for update (its lock and hidden columns are
// current): the permission on it decided again on its folders as locked,
// then its own hidden mark, then its own lock and those of the folders
// above it.
export async function noteWriteRefusal(
  tx: Transaction,
  grant: Grant,
  row: OwnLock & OwnHidden & { id: string; title: string; folderId: string | null },
  permission: NotePermission,
  view: AccessView = grant.view,
): Promise<Failure | null> {
  if (!isAgent(grant)) return null;
  const rows = await lockedChain(tx, row.folderId);
  const chain = rows.map((entry) => entry.id);
  const policy = grant.access.policy;
  const note = { kind: "note", id: row.id } as const;
  const refused = chainRefusal(policy, note, chain, hiddenOf(rows), permission);
  if (refused) return refused;
  const path = joinPath(pathAt(rows, 0), row.title);
  const own = ownLock(row);
  const locked = own
    ? lockedRefusal(view, { kind: "note", id: row.id, path }, own)
    : chainLockRefusal(rows, view);
  const mark = ownHidden(row);
  if (!mark) return locked;
  return hiddenRefusal({ kind: "note", id: row.id, path, title: row.title }, mark, locked);
}
