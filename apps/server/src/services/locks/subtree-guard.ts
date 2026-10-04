import { and, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import type { AccessView } from "../access/access-view";
import type { Grant } from "../access/authorize";
import { hiddenRefusal, ownHidden } from "../hidden/hidden-state";
import { joinPath } from "../notes/folder-index";
import { refuse } from "../notes/refusals";
import { isAgent, lockedRefusal } from "./lock-guard";
import { ownLock } from "./lock-state";

// A folder that goes to the trash or comes back takes everything below it
// along. An agent may do that only when nothing of it is hidden, it can see
// all of it (a deny_list token may have folders or notes excluded below a
// folder it can see) and nothing of it is locked - checked in this order.
// Called on rows the operation has locked or just written, so their lock
// and hidden columns are current; a refusal rolls it all back. Only items
// the agent can see are named: a hidden folder itself, never what lies
// below it.

// A visible hidden folder of the subtree (the topmost by path), else a
// visible hidden note in it; with the lock the same action meets, if any.
export async function subtreeHiddenRefusal(
  tx: Transaction,
  grant: Grant,
  view: AccessView,
  folderIds: readonly string[],
  noteWhere: SQL,
): Promise<Failure | null> {
  if (!isAgent(grant)) return null;
  const { index } = view;
  const [folderId] = folderIds
    .filter((id) => index.get(id)?.hidden && view.seesFolder(id))
    .sort((a, b) => index.pathOf(a).localeCompare(index.pathOf(b)));
  const folderMark = folderId ? index.get(folderId)?.hidden : undefined;
  const locked = () => subtreeLockRefusal(tx, grant, view, folderIds, noteWhere);
  if (folderId && folderMark) {
    const item = { kind: "folder" as const, id: folderId, path: index.pathOf(folderId) };
    return hiddenRefusal(item, folderMark, await locked());
  }
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(noteWhere, isNotNull(notes.hiddenAt), view.noteSql(null, notes.id, notes.folderId)))
    .orderBy(notes.id)
    .limit(1);
  const noteMark = note ? ownHidden(note) : null;
  if (!note || !noteMark) return null;
  const path = joinPath(index.pathOf(note.folderId), note.title);
  return hiddenRefusal(
    { kind: "note", id: note.id, path, title: note.title },
    noteMark,
    await locked(),
  );
}

// `folderIds`: the folders of the subtree; `noteWhere`: its notes.
export async function hiddenContentRefusal(
  tx: Transaction,
  grant: Grant,
  view: AccessView,
  folderIds: readonly string[],
  noteWhere: SQL,
): Promise<Failure | null> {
  if (!isAgent(grant)) return null;
  const hidden =
    folderIds.some((id) => !view.seesFolder(id)) ||
    (
      await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(noteWhere, sql`not ${view.noteSql(null, notes.id, notes.folderId)}`))
        .limit(1)
    ).length > 0;
  return hidden ? refuse("forbidden", { reason: "hidden_content" }) : null;
}

// The first visible locked folder of the subtree, else a visible locked note.
export async function subtreeLockRefusal(
  tx: Transaction,
  grant: Grant,
  view: AccessView,
  folderIds: readonly string[],
  noteWhere: SQL,
): Promise<Failure | null> {
  if (!isAgent(grant)) return null;
  const visibleIds = folderIds.filter((id) => view.seesFolder(id));
  const [folder] = await tx
    .select()
    .from(folders)
    .where(and(inArray(folders.id, visibleIds), isNotNull(folders.lockedAt)))
    .orderBy(folders.id)
    .limit(1);
  const folderLock = folder ? ownLock(folder) : null;
  if (folder && folderLock) {
    const item = { kind: "folder" as const, id: folder.id, path: view.index.pathOf(folder.id) };
    return lockedRefusal(view, item, folderLock);
  }
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(noteWhere, isNotNull(notes.lockedAt), view.noteSql(null, notes.id, notes.folderId)))
    .orderBy(notes.id)
    .limit(1);
  const noteLock = note ? ownLock(note) : null;
  if (!note || !noteLock) return null;
  const path = joinPath(view.index.pathOf(note.folderId), note.title);
  return lockedRefusal(view, { kind: "note", id: note.id, path }, noteLock);
}
