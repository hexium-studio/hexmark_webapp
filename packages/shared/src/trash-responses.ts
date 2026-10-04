import type { NoteWriteResult } from "./notes-responses";

// Answers of the trash endpoints of /api/notes/v1 and the MCP trash tools.
// Timestamps are ISO 8601 strings. Deleting moves a note or a folder (with
// everything in it) to the trash; the server purges it purgeAt, after the
// configured retention (TRASH_RETENTION_DAYS).

// A note moved to the trash.
export interface TrashedNote {
  kind: "note";
  id: string;
  // The version the deletion wrote (a revision with change "deleted").
  version: number;
  // Where it was: restore_note brings it back there.
  path: string;
  deletedAt: string;
  purgeAt: string;
  batchId: string;
}

// A folder moved to the trash with its subfolders and notes, as one batch.
export interface TrashedFolder {
  kind: "folder";
  id: string;
  path: string;
  deletedAt: string;
  purgeAt: string;
  batchId: string;
  // Moved along with it (not counting the folder itself).
  folderCount: number;
  noteCount: number;
}

// One entry of the trash listing: a note or folder deleted on its own, or
// the folder a batch was deleted with (its contents are counted, not listed).
export interface TrashEntry {
  kind: "note" | "folder";
  id: string;
  // The note's title or the folder's name.
  name: string;
  // Its path before it was deleted.
  path: string;
  // Where it was: a note's folder, a folder's parent. parentId is null for
  // the root level and for a parent outside the caller's folders; parentPath
  // is "" for the root level and null for a parent outside them.
  parentId: string | null;
  parentPath: string | null;
  deletedAt: string;
  deletedBy: string;
  purgeAt: string;
  batchId: string;
  // Notes only: the version the deletion wrote.
  version?: number;
  // Folders only: what was deleted along with it and is still in the trash.
  folderCount?: number;
  noteCount?: number;
}

export interface TrashListing {
  retentionDays: number;
  entries: TrashEntry[];
  // More entries than the limit.
  hasMore: boolean;
}

// A restored note: the answer of every note write (a new version).
export type RestoredNote = NoteWriteResult;

// A restored folder with the batch it was deleted with.
export interface RestoredFolder {
  id: string;
  name: string;
  path: string;
  // The batch it was deleted with, which came back with it.
  batchId: string;
  // Subfolders that came back with it: the folder itself is not counted
  // (like folderCount of the deletion).
  restoredSubfolders: number;
  // Notes that came back with it, each with a new version and a "restored"
  // revision.
  restoredNotes: number;
}

// Deleted for good (session only): what was removed.
export interface PurgedItems {
  notes: number;
  folders: number;
}

// Details of 409 in_trash.
export interface InTrashDetails {
  deletedAt: string;
  purgeAt: string;
}

// The folder a batch was deleted with, when that is not the item named
// itself: restore_folder takes its id to bring the whole batch back. Left
// out for a note deleted on its own, for the folder the batch was deleted
// with, and when that folder lies outside the caller's folders.
export interface BatchRootDetails {
  batchRootId?: string;
  batchRootPath?: string;
}

// Details of 409 in_trash: a note named by its id is in the trash.
export interface NoteInTrashDetails extends InTrashDetails, BatchRootDetails {
  // Shared by everything deleted together (list_trash shows the batch).
  batchId: string;
  // Where it was: folder path and title.
  path: string;
}

// Details of 409 folder_in_trash: a folder named by its id is in the trash.
export interface FolderInTrashDetails extends InTrashDetails, BatchRootDetails {
  // The folder in the trash and where it was.
  folderId: string;
  path: string;
  // Shared by everything deleted together; restore_folder takes the id of
  // the folder the batch was deleted with (batchRootId, or folderId itself).
  batchId: string;
}

// Details of 409 folder_cycle: the folder that was to move and the parent
// it was to move into (the folder itself or one of its subfolders).
export interface FolderCycleDetails {
  folderId: string;
  path: string;
  parentId: string;
  parentPath: string;
}

// Details of 409 parent_in_trash: the folder that is in the trash.
export interface ParentInTrashDetails {
  folderId: string;
  path: string;
}
