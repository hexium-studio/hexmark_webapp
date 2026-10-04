import type { NoteChange } from "@hexmark/shared";
import type { AccessEvent } from "../audit/access-events";
import { type FolderIndex, joinPath } from "./folder-index";
import type { NoteRow } from "./note-store";

// What the audit log records about a change of a note: the note (its path
// after the change), the versions, and what moved or was renamed - never
// the body, only its length.

type NoteState = Pick<NoteRow, "id" | "title" | "folderId" | "version" | "body">;

function pathOf(row: Pick<NoteRow, "title" | "folderId">, index: FolderIndex): string {
  return joinPath(index.pathOf(row.folderId), row.title);
}

export interface NoteChangeFacts {
  change: NoteChange | null;
  sectionPath?: string;
  batchId?: string | null;
}

// `before`: the note as locked; `after`: as written (the same when nothing
// changed, which is logged too, with changed: false).
export function noteChangeEvent(
  action: AccessEvent["action"],
  before: NoteState,
  after: NoteState,
  index: FolderIndex,
  facts: NoteChangeFacts,
  reason: string | undefined,
): AccessEvent {
  const changed = facts.change !== null;
  const path = pathOf(after, index);
  const previousPath = pathOf(before, index);
  return {
    action,
    target: { kind: "note", id: after.id, label: path },
    reason: changed ? (reason ?? null) : null,
    details: {
      changed,
      ...(facts.change ? { change: facts.change } : {}),
      version: after.version,
      ...(changed ? { previousVersion: before.version } : {}),
      ...(previousPath !== path ? { previousPath } : {}),
      ...(before.title !== after.title ? { previousTitle: before.title, title: after.title } : {}),
      ...(before.body !== after.body ? { bodyCharacters: Array.from(after.body).length } : {}),
      ...(facts.sectionPath ? { sectionPath: facts.sectionPath } : {}),
      ...(facts.batchId ? { batchId: facts.batchId } : {}),
    },
  };
}

export function noteCreatedEvent(
  row: NoteState,
  index: FolderIndex,
  reason: string | undefined,
): AccessEvent {
  return {
    action: "note.created",
    target: { kind: "note", id: row.id, label: pathOf(row, index) },
    reason: reason ?? null,
    details: { version: row.version, bodyCharacters: Array.from(row.body).length },
  };
}
