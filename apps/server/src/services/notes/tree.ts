import type { TreeFolder, TreeNote, TreeResponse } from "@hexmark/shared";
import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { noteRevisions, notes } from "../../db/schema";
import { folderHiddenState, noteHiddenState } from "../hidden/hidden-state";
import { isAgent } from "../locks/lock-guard";
import { folderLockState, noteLockState } from "../locks/lock-state";
import type { FolderEntry } from "./folder-index";
import type { ReadContext } from "./read-frame";

// The folder tree with note titles (no bodies), from a folder or the root
// level down to `depth` levels: depth 1 lists the folder's subfolders and
// notes, each further level opens the subfolders one more step. A folder
// where the depth ends is listed with loaded: false and its counts only.
// Only what the caller may read is listed and counted. A caller that cannot
// read the root level (an allow_list token) gets, at the top, the folders
// and notes it may read whose folder it cannot. A hidden folder is shown to
// an agent without contents or counts (nothing below it exists for it);
// listing it is refused (tree-listing.ts).

const readable = (context: ReadContext) =>
  context.grant.view.noteSql("read", notes.id, notes.folderId);

async function noteRows(context: ReadContext, where: SQL) {
  return context.tx
    .select({
      id: notes.id,
      title: notes.title,
      version: notes.version,
      updatedAt: notes.updatedAt,
      updatedBy: notes.updatedByName,
      // What the current version changed (its revision).
      lastChange: noteRevisions.change,
      folderId: notes.folderId,
      lockedAt: notes.lockedAt,
      lockedByName: notes.lockedByName,
      lockReason: notes.lockReason,
      hiddenAt: notes.hiddenAt,
      hiddenByName: notes.hiddenByName,
      hideReason: notes.hideReason,
    })
    .from(notes)
    .leftJoin(
      noteRevisions,
      and(eq(noteRevisions.noteId, notes.id), eq(noteRevisions.version, notes.version)),
    )
    .where(and(isNull(notes.deletedAt), readable(context), where))
    .orderBy(asc(sql`lower(${notes.title})`));
}

type NoteRowOf = Awaited<ReturnType<typeof noteRows>>[number];

function treeNote(context: ReadContext, row: NoteRowOf, detached: boolean): TreeNote {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    // Every version has its revision; the fallback only keeps the shape.
    lastChange: row.lastChange ?? "edited",
    locked: noteLockState(context.grant.view, row),
    hidden: noteHiddenState(context.grant.view, row),
    ...(detached ? { folderPath: context.index.pathOf(row.folderId) } : {}),
  };
}

async function notesIn(context: ReadContext, folderIds: (string | null)[]) {
  const ids = folderIds.filter((id): id is string => id !== null);
  const includeRoot = folderIds.includes(null);
  const rows = await noteRows(
    context,
    sql`(${notes.folderId} = any(${sql.param(ids)}::uuid[]) or (${includeRoot} and ${notes.folderId} is null))`,
  );
  const byFolder = new Map<string | null, TreeNote[]>();
  for (const row of rows) {
    const list = byFolder.get(row.folderId) ?? [];
    list.push(treeNote(context, row, false));
    byFolder.set(row.folderId, list);
  }
  return byFolder;
}

// Readable notes per folder, for folders whose notes are not listed.
async function noteCounts(context: ReadContext, folderIds: string[]) {
  const counts = new Map<string, number>();
  if (folderIds.length === 0) return counts;
  const rows = await context.tx
    .select({ folderId: notes.folderId, count: sql<number>`count(*)::int` })
    .from(notes)
    .where(
      and(
        isNull(notes.deletedAt),
        readable(context),
        sql`${notes.folderId} = any(${sql.param(folderIds)}::uuid[])`,
      ),
    )
    .groupBy(notes.folderId);
  for (const row of rows) if (row.folderId) counts.set(row.folderId, row.count);
  return counts;
}

function childrenOf(context: ReadContext, folderId: string | null): FolderEntry[] {
  const { view } = context.grant;
  return context.index.children(folderId).filter((entry) => view.seesFolder(entry.id, "read"));
}

// Top entries: the folder's readable children; at the root level for a
// caller that cannot read it, the readable folders whose parent it cannot.
function topFolders(context: ReadContext, folderId: string | null): FolderEntry[] {
  const { grant, index } = context;
  if (folderId !== null || grant.view.seesFolder(null, "read"))
    return childrenOf(context, folderId);
  return (grant.view.folderIds("read") ?? [])
    .map((id) => index.get(id))
    .filter((entry): entry is FolderEntry => entry !== undefined)
    .filter((entry) => !grant.view.seesFolder(entry.parentId, "read"))
    .sort((a, b) => index.pathOf(a.id).localeCompare(index.pathOf(b.id)));
}

// Notes readable on their own (a single note on an allow_list) whose folder
// the caller cannot read: listed at the top, with their folder's path.
async function detachedNotes(context: ReadContext): Promise<TreeNote[]> {
  const folders = context.grant.view.folderIds("read") ?? [];
  const rows = await noteRows(
    context,
    sql`(${notes.folderId} is null or not ${notes.folderId} = any(${sql.param(folders)}::uuid[]))`,
  );
  return rows.map((row) => treeNote(context, row, true));
}

export async function buildTree(
  context: ReadContext,
  folderId: string | null,
  depth: number,
): Promise<TreeResponse> {
  const { index, grant } = context;
  // Folders whose contents are listed, level by level.
  const opened: (string | null)[] = [folderId];
  const levels: FolderEntry[][] = [topFolders(context, folderId)];
  for (let level = 1; level < depth; level++) {
    const previous = levels[level - 1] ?? [];
    opened.push(...previous.map((entry) => entry.id));
    levels.push(previous.flatMap((entry) => childrenOf(context, entry.id)));
  }
  const byFolder = await notesIn(context, opened);
  const counted = await noteCounts(
    context,
    (levels[depth - 1] ?? []).map((entry) => entry.id),
  );
  const agent = isAgent(grant);
  const describe = (entry: FolderEntry, level: number): TreeFolder => {
    const children = childrenOf(context, entry.id);
    const base = {
      id: entry.id,
      name: entry.name,
      path: index.pathOf(entry.id),
      folderCount: children.length,
      locked: folderLockState(grant.view, entry.id),
      hidden: folderHiddenState(grant.view, entry.id),
    };
    if (agent && entry.hidden) {
      return { ...base, folderCount: null, noteCount: null, loaded: false };
    }
    if (level + 1 >= depth) {
      return { ...base, noteCount: counted.get(entry.id) ?? 0, loaded: false };
    }
    const folderNotes = byFolder.get(entry.id) ?? [];
    return {
      ...base,
      noteCount: folderNotes.length,
      loaded: true,
      folders: children.map((child) => describe(child, level + 1)),
      notes: folderNotes,
    };
  };
  const folder = folderId === null ? null : index.get(folderId);
  const top =
    folderId === null && !grant.view.seesFolder(null, "read")
      ? await detachedNotes(context)
      : (byFolder.get(folderId) ?? []);
  return {
    folder: folder
      ? {
          id: folder.id,
          name: folder.name,
          path: index.pathOf(folder.id),
          locked: folderLockState(grant.view, folder.id),
          hidden: folderHiddenState(grant.view, folder.id),
        }
      : null,
    folders: (levels[0] ?? []).map((entry) => describe(entry, 0)),
    notes: top,
  };
}
