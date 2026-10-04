import type { TrashEntry, TrashListing } from "@hexmark/shared";
import { eq, sql } from "drizzle-orm";
import { trashRetentionDays } from "../../config/trash";
import { folders } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { folderSubtreeIds, joinPath } from "../notes/folder-index";
import { withRead } from "../notes/read-frame";
import { refuse } from "../notes/refusals";
import { purgeAt } from "./retention";

// What is in the trash, newest first: every note and folder deleted on its
// own, and the folder each batch was deleted with (what went along is
// counted, not listed). A token sees only the items it holds delete on,
// judged by where they lay (services/access). `folderId` narrows the listing to items that lay inside that
// folder (in use or in the trash) or below it. What went along with a folder
// is counted only as far as the caller can see it: nothing below a hidden
// folder, for an agent.

interface EntryRow extends Record<string, unknown> {
  kind: "note" | "folder";
  id: string;
  name: string;
  // Notes: their folder; folders: their parent.
  location: string | null;
  deleted_at: Date | string;
  deleted_by_name: string;
  trash_batch_id: string;
  version: number | null;
  folder_count: number | null;
  note_count: number | null;
}

export function listTrash(
  ref: AccessRef,
  now: Date,
  input: { folderId: string | null; limit: number },
): Promise<Outcome<TrashListing>> {
  const request = { ref, now, permission: "delete", action: "read.trash", input } as const;
  return withRead(
    request,
    async ({ tx, grant }) => {
      const view = await grant.trashView();
      let within = sql`true`;
      if (input.folderId !== null) {
        const [folder] = await tx
          .select({ id: folders.id })
          .from(folders)
          .where(eq(folders.id, input.folderId));
        if (!folder || !view.seesFolder(folder.id)) return refuse("folder_not_found");
        const ids = await folderSubtreeIds(tx, [folder.id], true);
        within = sql`location = any(${sql.param(ids)}::uuid[])`;
      }
      const folderIds = view.folderIds("delete");
      const visibleFolder =
        folderIds === null ? sql`true` : sql`f.id = any(${sql.param(folderIds)}::uuid[])`;
      const seen = view.folderIds();
      const countedFolder = seen === null ? sql`true` : sql`c.id = any(${sql.param(seen)}::uuid[])`;
      const countedNote = view.noteSql(null, sql`m.id`, sql`m.folder_id`);
      const rows = await tx.execute<EntryRow>(sql`
      select * from (
        select 'note' as kind, n.id, n.title as name, n.folder_id as location,
          n.deleted_at, n.deleted_by_name, n.trash_batch_id,
          n.version, null::int as folder_count, null::int as note_count
        from notes n
        where n.deleted_at is not null and not exists (
          select 1 from folders f where f.id = n.folder_id and f.trash_batch_id = n.trash_batch_id)
          and ${view.noteSql("delete", sql`n.id`, sql`n.folder_id`)}
        union all
        select 'folder', f.id, f.name, f.parent_id, f.deleted_at, f.deleted_by_name,
          f.trash_batch_id, null,
          (select count(*)::int from folders c
            where c.trash_batch_id = f.trash_batch_id and c.id <> f.id and ${countedFolder}),
          (select count(*)::int from notes m
            where m.trash_batch_id = f.trash_batch_id and ${countedNote})
        from folders f
        where f.deleted_at is not null and not exists (
          select 1 from folders p where p.id = f.parent_id and p.trash_batch_id = f.trash_batch_id)
          and ${visibleFolder}
      ) entry
      where ${within}
      order by deleted_at desc, kind, lower(name), id
      limit ${input.limit + 1}
    `);
      const { index } = view;
      // Where an entry was ("" and null: the root level). Named only when the
      // caller can see it: a folder's parent may lie outside what it reaches.
      const parentOf = (location: string | null) =>
        view.seesFolder(location)
          ? { parentId: location, parentPath: index.pathOf(location) }
          : { parentId: null, parentPath: null };
      const entries = rows.slice(0, input.limit).map((row): TrashEntry => {
        const deletedAt = new Date(row.deleted_at);
        const base = {
          kind: row.kind,
          id: row.id,
          name: row.name,
          path:
            row.kind === "note"
              ? joinPath(index.pathOf(row.location), row.name)
              : index.pathOf(row.id),
          ...parentOf(row.location),
          deletedAt: deletedAt.toISOString(),
          deletedBy: row.deleted_by_name,
          purgeAt: purgeAt(deletedAt, trashRetentionDays).toISOString(),
          batchId: row.trash_batch_id,
        };
        return row.kind === "note"
          ? { ...base, version: row.version ?? 0 }
          : { ...base, folderCount: row.folder_count ?? 0, noteCount: row.note_count ?? 0 };
      });
      return { retentionDays: trashRetentionDays, entries, hasMore: rows.length > input.limit };
    },
    (listing) => ({ details: { entryCount: listing.entries.length } }),
  );
}
