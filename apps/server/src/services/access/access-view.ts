import type { NotePermission } from "@hexmark/shared";
import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { FolderIndex } from "../notes/folder-index";
import {
  type AccessPolicy,
  concealed,
  contentPermissions,
  folderPermissions,
  isAgentPolicy,
  notePermissions,
} from "./policy";

// An access policy (policy.ts) applied to the folder tree of one
// transaction: permissions per folder and note, and the same decision as
// SQL conditions for listings and search. Built once per operation, from the
// folders in use or (for the trash) from all folders, so an item in the
// trash is judged by the folders it lay in - and hidden by the folders
// hidden among them (the index's hidden marks).

// null: any permission (visible at all).
export type Wanted = NotePermission | null;

function has(permissions: readonly NotePermission[], wanted: Wanted): boolean {
  return wanted === null ? permissions.length > 0 : permissions.includes(wanted);
}

const uuidList = (ids: Iterable<string>) => sql`${sql.param([...ids])}::uuid[]`;

export class AccessView {
  private readonly folderCache = new Map<string, readonly NotePermission[]>();
  private readonly contentCache = new Map<string, readonly NotePermission[]>();

  constructor(
    readonly policy: AccessPolicy,
    readonly index: FolderIndex,
  ) {}

  private cached(
    cache: Map<string, readonly NotePermission[]>,
    folderId: string | null,
    decide: typeof folderPermissions,
  ): readonly NotePermission[] {
    const key = folderId ?? "";
    let found = cache.get(key);
    if (!found) {
      found = decide(this.policy, this.index.chain(folderId), this.index.hidden);
      cache.set(key, found);
    }
    return found;
  }

  // The folder itself; null: the root level.
  folder(folderId: string | null): readonly NotePermission[] {
    return this.cached(this.folderCache, folderId, folderPermissions);
  }

  // What lies directly in the folder (policy.ts, contentPermissions).
  contents(folderId: string | null): readonly NotePermission[] {
    return this.cached(this.contentCache, folderId, contentPermissions);
  }

  note(noteId: string, folderId: string | null): readonly NotePermission[] {
    const listed = this.policy.mode !== "all" && this.policy.notes.has(noteId);
    return listed
      ? notePermissions(this.policy, noteId, this.index.chain(folderId), this.index.hidden)
      : this.contents(folderId);
  }

  // The caller is an agent and this folder or one above it is hidden: what
  // lies in it does not exist for the caller.
  conceals(folderId: string | null): boolean {
    return concealed(this.policy, this.index.chain(folderId), this.index.hidden, 0);
  }

  seesFolder(folderId: string | null, wanted: Wanted = null): boolean {
    return has(this.folder(folderId), wanted);
  }

  // A folder's id as an answer may name it: null for a folder the caller
  // cannot see (its name may still show in a path), as for the root level.
  shownFolderId(folderId: string | null): string | null {
    return folderId !== null && this.seesFolder(folderId) ? folderId : null;
  }

  // The same for a note, e.g. one holding a title the caller wanted.
  shownNoteId(note: { id: string; folderId: string | null }): string | null {
    return this.seesNote(note) ? note.id : null;
  }

  seesNote(note: { id: string; folderId: string | null }, wanted: Wanted = null): boolean {
    return has(this.note(note.id, note.folderId), wanted);
  }

  // Folders of the index granting `wanted`; null when that is every folder.
  folderIds(wanted: Wanted = null): string[] | null {
    if (this.policy.mode === "all") return has(this.folder(null), wanted) ? null : [];
    return this.index.ids().filter((id) => this.seesFolder(id, wanted));
  }

  // The folders of the index whose contents an agent cannot see.
  concealedIds(): string[] {
    return isAgentPolicy(this.policy) ? this.index.ids().filter((id) => this.conceals(id)) : [];
  }

  // Limits a query of notes to those granting `wanted`: in a folder (or at
  // the root level) whose contents grant it, or listed on their own - never
  // in a folder whose contents are concealed.
  noteSql(wanted: Wanted, id: PgColumn | SQL, folderId: PgColumn | SQL): SQL {
    const { policy } = this;
    if (policy.mode === "all") return has(this.folder(null), wanted) ? sql`true` : sql`false`;
    const folders = this.index.ids().filter((folder) => has(this.contents(folder), wanted));
    const inFolders = sql`${folderId} = any(${uuidList(folders)})`;
    const atRoot = has(this.contents(null), wanted) ? sql`${folderId} is null` : sql`false`;
    const hidden = this.concealedIds();
    const outsideHidden = sql`(${folderId} is null or not ${folderId} = any(${uuidList(hidden)}))`;
    if (policy.mode === "allow_list") {
      const listed = [...policy.notes.keys()].filter((noteId) =>
        has(notePermissions(policy, noteId, [], this.index.hidden), wanted),
      );
      return sql`((${inFolders} or ${atRoot} or ${id} = any(${uuidList(listed)})) and ${outsideHidden})`;
    }
    return sql`((${inFolders} or ${atRoot}) and not ${id} = any(${uuidList(policy.notes)}))`;
  }
}
