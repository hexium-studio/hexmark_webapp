import { PATH_SEPARATOR } from "@hexmark/shared";
import { isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders } from "../../db/schema";

// The folder tree as one in-memory index, loaded per operation: folder paths
// for answers, path lookups for addressing, subtrees for listings. A wiki's
// folders are few compared with its notes, so one query is cheaper than
// walking the tree row by row.

export interface FolderEntry {
  id: string;
  parentId: string | null;
  name: string;
}

export class FolderIndex {
  private readonly byId = new Map<string, FolderEntry>();
  private readonly paths = new Map<string, string>();
  private readonly childLists = new Map<string | null, FolderEntry[]>();

  constructor(entries: readonly FolderEntry[]) {
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
      const siblings = this.childLists.get(entry.parentId) ?? [];
      siblings.push(entry);
      this.childLists.set(entry.parentId, siblings);
    }
    for (const list of this.childLists.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): FolderEntry | undefined {
    return this.byId.get(id);
  }

  // Sorted by name.
  children(parentId: string | null): FolderEntry[] {
    return this.childLists.get(parentId) ?? [];
  }

  // "Projects/Web"; "" for the root level and for unknown folders.
  pathOf(id: string | null): string {
    if (id === null) return "";
    const cached = this.paths.get(id);
    if (cached !== undefined) return cached;
    const names: string[] = [];
    const seen = new Set<string>();
    for (let current = this.byId.get(id); current; current = this.parentOf(current)) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      names.unshift(current.name);
    }
    const path = names.join(PATH_SEPARATOR);
    this.paths.set(id, path);
    return path;
  }

  // The folder at these names from the root (ignoring case); undefined when
  // there is none. An empty list is the root level (null).
  findByNames(names: readonly string[]): string | null | undefined {
    let parentId: string | null = null;
    for (const name of names) {
      const lower = name.toLowerCase();
      const next: FolderEntry | undefined = this.children(parentId).find(
        (entry) => entry.name.toLowerCase() === lower,
      );
      if (!next) return undefined;
      parentId = next.id;
    }
    return parentId;
  }

  private parentOf(entry: FolderEntry): FolderEntry | undefined {
    return entry.parentId === null ? undefined : this.byId.get(entry.parentId);
  }
}

// Folders in use; `withTrash` adds those in the trash, for paths of items
// in the trash (their original paths).
export async function loadFolderIndex(tx: Transaction, withTrash = false): Promise<FolderIndex> {
  const rows = await tx
    .select({ id: folders.id, parentId: folders.parentId, name: folders.name })
    .from(folders)
    .where(withTrash ? undefined : isNull(folders.deletedAt));
  return new FolderIndex(rows);
}

// The given folders and all folders below them (recursive CTE), without
// folders in the trash unless `withTrash` asks for them.
export async function folderSubtreeIds(
  tx: Transaction,
  roots: readonly string[],
  withTrash = false,
): Promise<string[]> {
  if (roots.length === 0) return [];
  const live = withTrash ? sql`true` : sql`deleted_at is null`;
  const liveChild = withTrash ? sql`true` : sql`child.deleted_at is null`;
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive subtree(id) as (
      select id from folders where id = any(${sql.param(roots)}::uuid[]) and ${live}
      union
      select child.id from folders child join subtree on child.parent_id = subtree.id
      where ${liveChild}
    )
    select id from subtree
  `);
  return rows.map((row) => row.id);
}

// A folder path joined with a name: a note's path, or a subfolder's.
export function joinPath(folderPath: string, name: string): string {
  return folderPath ? `${folderPath}${PATH_SEPARATOR}${name}` : name;
}
