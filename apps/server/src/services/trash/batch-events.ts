import type { AccessEvent } from "../audit/access-events";
import { type AuditItem, auditItemList } from "../audit/item-list";
import { type FolderIndex, joinPath } from "../notes/folder-index";
import type { MarkedNote } from "./trash-store";

// The audit events of a folder going to the trash with everything in it, or
// coming back (one batch). The folder's own event (folder.deleted,
// folder.restored) lists the notes and subfolders of the batch with their
// ids and paths (item-list.ts, capped). Besides, every note and subfolder
// gets an event of its own (note.deleted / folder.deleted, note.restored /
// folder.restored) with details.viaFolder naming the folder the batch went
// with, so the log filtered by a note's id shows what happened to it.

export interface BatchRoot {
  id: string;
  path: string;
}

export interface BatchMembers {
  // Subfolders (not the root) and notes of the batch, with their paths.
  folders: AuditItem[];
  notes: (AuditItem & { version: number })[];
}

// Notes as markNotes returned them, with their paths from `index`.
export function markedNoteItems(marked: readonly MarkedNote[], index: FolderIndex) {
  return marked.map((note) => ({
    kind: "note" as const,
    id: note.id,
    path: joinPath(index.pathOf(note.folderId), note.title),
    version: note.version,
  }));
}

export function folderItems(ids: readonly string[], rootId: string, index: FolderIndex) {
  return ids
    .filter((id) => id !== rootId)
    .map((id) => ({ kind: "folder" as const, id, path: index.pathOf(id) }));
}

// The root's details besides its own facts: the items list.
export function batchItemDetails(members: BatchMembers) {
  return auditItemList([...members.folders, ...members.notes]);
}

// One event per subfolder and note of the batch.
export function batchMemberEvents(
  change: "deleted" | "restored",
  root: BatchRoot,
  members: BatchMembers,
  facts: { batchId: string; reason: string | null },
): AccessEvent[] {
  const viaFolder = { id: root.id, path: root.path };
  const shared = { batchId: facts.batchId, viaFolder };
  return [
    ...members.folders.map((folder) => ({
      action: `folder.${change}` as const,
      target: { kind: "folder" as const, id: folder.id, label: folder.path },
      reason: facts.reason,
      details: shared,
    })),
    ...members.notes.map((note) => ({
      action: `note.${change}` as const,
      target: { kind: "note" as const, id: note.id, label: note.path },
      reason: facts.reason,
      details: {
        ...shared,
        changed: true,
        change,
        version: note.version,
        previousVersion: note.version - 1,
      },
    })),
  ];
}
