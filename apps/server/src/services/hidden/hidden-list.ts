import type { HiddenItem } from "@hexmark/shared";
import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { folders, notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { isAgent } from "../locks/lock-guard";
import { folderSubtreeIds, joinPath } from "../notes/folder-index";
import { withRead } from "../notes/read-frame";
import { refuse } from "../notes/refusals";

// The notes and folders in use that are hidden themselves, sorted by path,
// for people (the web app's /locked page): what agents cannot read, and
// where to unhide it. A hidden folder hides what lies below it: the counts
// say how many notes and folders that is now (they are not listed one by
// one). Agents are refused: they cannot learn what lies below a hidden
// folder, not even how much.

export function listHidden(ref: AccessRef, now: Date): Promise<Outcome<{ items: HiddenItem[] }>> {
  const request = { ref, now, permission: "read", action: "read.hidden" } as const;
  return withRead(request, async ({ tx, grant, index }) => {
    if (isAgent(grant)) return refuse("forbidden", { reason: "session_required" });
    const hiddenFolders = await tx
      .select()
      .from(folders)
      .where(and(isNull(folders.deletedAt), isNotNull(folders.hiddenAt)));
    const hiddenNotes = await tx
      .select({
        id: notes.id,
        title: notes.title,
        folderId: notes.folderId,
        hiddenAt: notes.hiddenAt,
        hiddenByName: notes.hiddenByName,
        hideReason: notes.hideReason,
      })
      .from(notes)
      .where(and(isNull(notes.deletedAt), isNotNull(notes.hiddenAt)));
    const items: HiddenItem[] = [];
    for (const row of hiddenFolders) {
      const below = (await folderSubtreeIds(tx, [row.id])).filter((id) => id !== row.id);
      const [counted] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notes)
        .where(
          and(
            isNull(notes.deletedAt),
            sql`${notes.folderId} = any(${sql.param([row.id, ...below])}::uuid[])`,
          ),
        );
      items.push({
        kind: "folder",
        id: row.id,
        path: index.pathOf(row.id),
        hiddenAt: (row.hiddenAt ?? now).toISOString(),
        hiddenBy: row.hiddenByName ?? "",
        reason: row.hideReason,
        coveredFolders: below.length,
        coveredNotes: counted?.count ?? 0,
      });
    }
    for (const row of hiddenNotes) {
      items.push({
        kind: "note",
        id: row.id,
        path: joinPath(index.pathOf(row.folderId), row.title),
        hiddenAt: (row.hiddenAt ?? now).toISOString(),
        hiddenBy: row.hiddenByName ?? "",
        reason: row.hideReason,
        coveredFolders: 0,
        coveredNotes: 0,
      });
    }
    items.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
    return { items };
  });
}
