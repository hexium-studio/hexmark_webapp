import type { LockedItem } from "@hexmark/shared";
import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { folders, notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { folderSubtreeIds, joinPath } from "../notes/folder-index";
import { withRead } from "../notes/read-frame";

// The notes and folders in use that hold a lock of their own and that the
// caller may read, sorted by path. A folder's lock covers what lies below it:
// the counts say how many readable notes and folders that is now (items
// inherit the lock, so they are not listed one by one).

export function listLocked(ref: AccessRef, now: Date): Promise<Outcome<{ items: LockedItem[] }>> {
  const request = { ref, now, permission: "read", action: "read.locked" } as const;
  return withRead(
    request,
    async ({ tx, grant, index }) => {
      const { view } = grant;
      const lockedFolders = (
        await tx
          .select()
          .from(folders)
          .where(and(isNull(folders.deletedAt), isNotNull(folders.lockedAt)))
      ).filter((row) => view.seesFolder(row.id, "read"));
      const lockedNotes = await tx
        .select({
          id: notes.id,
          title: notes.title,
          folderId: notes.folderId,
          lockedAt: notes.lockedAt,
          lockedByName: notes.lockedByName,
          lockReason: notes.lockReason,
        })
        .from(notes)
        .where(
          and(
            isNull(notes.deletedAt),
            isNotNull(notes.lockedAt),
            view.noteSql("read", notes.id, notes.folderId),
          ),
        );
      const items: LockedItem[] = [];
      for (const row of lockedFolders) {
        const below = (await folderSubtreeIds(tx, [row.id])).filter(
          (id) => id !== row.id && view.seesFolder(id, "read"),
        );
        const [counted] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(notes)
          .where(
            and(
              isNull(notes.deletedAt),
              sql`${notes.folderId} = any(${sql.param([row.id, ...below])}::uuid[])`,
              view.noteSql("read", notes.id, notes.folderId),
            ),
          );
        items.push({
          kind: "folder",
          id: row.id,
          path: index.pathOf(row.id),
          lockedAt: (row.lockedAt ?? now).toISOString(),
          lockedBy: row.lockedByName ?? "",
          reason: row.lockReason,
          coveredFolders: below.length,
          coveredNotes: counted?.count ?? 0,
        });
      }
      for (const row of lockedNotes) {
        items.push({
          kind: "note",
          id: row.id,
          path: joinPath(index.pathOf(row.folderId), row.title),
          lockedAt: (row.lockedAt ?? now).toISOString(),
          lockedBy: row.lockedByName ?? "",
          reason: row.lockReason,
          coveredFolders: 0,
          coveredNotes: 0,
        });
      }
      items.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
      return { items };
    },
    (listing) => ({ details: { itemCount: listing.items.length } }),
  );
}
