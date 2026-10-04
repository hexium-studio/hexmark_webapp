import type { TreeFolder, TreeNote, TreeResponse } from "@hexmark/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { noteRevisions, notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { canSeeFolder, visibleFolderSql } from "../access/authorize";
import { missingFolder } from "../trash/in-trash";
import type { FolderEntry } from "./folder-index";
import { type ReadContext, withRead } from "./read-frame";
import { refuse } from "./refusals";

// The folder tree with note titles (no bodies), from a folder or the root
// level down to `depth` levels: depth 1 lists the folder's subfolders and
// notes, each further level opens the subfolders one more step. A folder
// where the depth ends is listed with loaded: false and its counts only.

async function notesIn(context: ReadContext, folderIds: (string | null)[]) {
  const ids = folderIds.filter((id): id is string => id !== null);
  const includeRoot = folderIds.includes(null);
  const rows = await context.tx
    .select({
      id: notes.id,
      title: notes.title,
      version: notes.version,
      updatedAt: notes.updatedAt,
      updatedBy: notes.updatedByName,
      // What the current version changed (its revision).
      lastChange: noteRevisions.change,
      folderId: notes.folderId,
    })
    .from(notes)
    .leftJoin(
      noteRevisions,
      and(eq(noteRevisions.noteId, notes.id), eq(noteRevisions.version, notes.version)),
    )
    .where(
      and(
        isNull(notes.deletedAt),
        visibleFolderSql(context.grant, notes.folderId),
        sql`(${notes.folderId} = any(${sql.param(ids)}::uuid[]) or (${includeRoot} and ${notes.folderId} is null))`,
      ),
    )
    .orderBy(asc(sql`lower(${notes.title})`));
  const byFolder = new Map<string | null, TreeNote[]>();
  for (const row of rows) {
    const list = byFolder.get(row.folderId) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      // Every version has its revision; the fallback only keeps the shape.
      lastChange: row.lastChange ?? "edited",
    });
    byFolder.set(row.folderId, list);
  }
  return byFolder;
}

// Visible notes per folder, for folders whose notes are not listed.
async function noteCounts(context: ReadContext, folderIds: string[]) {
  const counts = new Map<string, number>();
  if (folderIds.length === 0) return counts;
  const rows = await context.tx
    .select({ folderId: notes.folderId, count: sql<number>`count(*)::int` })
    .from(notes)
    .where(
      and(
        isNull(notes.deletedAt),
        visibleFolderSql(context.grant, notes.folderId),
        sql`${notes.folderId} = any(${sql.param(folderIds)}::uuid[])`,
      ),
    )
    .groupBy(notes.folderId);
  for (const row of rows) if (row.folderId) counts.set(row.folderId, row.count);
  return counts;
}

// Top entries: the folder's children, or at the root level for a token
// limited to folders, its visible folders whose parent it cannot see.
function topFolders(context: ReadContext, folderId: string | null): FolderEntry[] {
  const { grant, index } = context;
  if (folderId !== null || grant.scope === null) return index.children(folderId);
  return [...grant.scope]
    .map((id) => index.get(id))
    .filter((entry): entry is FolderEntry => entry !== undefined)
    .filter((entry) => !canSeeFolder(grant, entry.parentId))
    .sort((a, b) => index.pathOf(a.id).localeCompare(index.pathOf(b.id)));
}

export async function buildTree(
  context: ReadContext,
  folderId: string | null,
  depth: number,
): Promise<TreeResponse> {
  const { index } = context;
  // Folders whose contents are listed, level by level.
  const opened: (string | null)[] = [folderId];
  const levels: FolderEntry[][] = [topFolders(context, folderId)];
  for (let level = 1; level < depth; level++) {
    const previous = levels[level - 1] ?? [];
    opened.push(...previous.map((entry) => entry.id));
    levels.push(previous.flatMap((entry) => index.children(entry.id)));
  }
  const byFolder = await notesIn(context, opened);
  const counted = await noteCounts(
    context,
    (levels[depth - 1] ?? []).map((entry) => entry.id),
  );
  const describe = (entry: FolderEntry, level: number): TreeFolder => {
    const children = index.children(entry.id);
    const base = { id: entry.id, name: entry.name, path: index.pathOf(entry.id) };
    if (level + 1 >= depth) {
      const noteCount = counted.get(entry.id) ?? 0;
      return { ...base, folderCount: children.length, noteCount, loaded: false };
    }
    const folderNotes = byFolder.get(entry.id) ?? [];
    return {
      ...base,
      folderCount: children.length,
      noteCount: folderNotes.length,
      loaded: true,
      folders: children.map((child) => describe(child, level + 1)),
      notes: folderNotes,
    };
  };
  const folder = folderId === null ? null : index.get(folderId);
  return {
    folder: folder ? { id: folder.id, name: folder.name, path: index.pathOf(folder.id) } : null,
    folders: (levels[0] ?? []).map((entry) => describe(entry, 0)),
    notes: byFolder.get(folderId) ?? [],
  };
}

export function listTree(
  ref: AccessRef,
  now: Date,
  input: { folderId: string | null; depth: number },
): Promise<Outcome<TreeResponse>> {
  const request = { ref, now, permission: "read", action: "read.folder", input } as const;
  return withRead(
    request,
    async (context) => {
      if (input.folderId !== null) {
        const known = context.index.get(input.folderId);
        if (!known) return missingFolder(context.tx, context.grant, input.folderId);
        if (!canSeeFolder(context.grant, known.id)) return refuse("folder_not_found");
      }
      return buildTree(context, input.folderId, input.depth);
    },
    (tree) => ({
      target: tree.folder ? { kind: "folder", id: tree.folder.id, label: tree.folder.path } : null,
      details: { folderCount: tree.folders.length, noteCount: tree.notes.length },
    }),
  );
}
