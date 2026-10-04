import type { NoteWriteResult } from "@hexmark/shared";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { NoteRef } from "./addressing";
import { lockTargetFolder } from "./note-create";
import { writeNote } from "./note-write";

// Moving a note to another folder. The note keeps its id; the move is a new
// version with its revision. Into the trash and back: services/trash.

export function moveNote(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  input: { expectedVersion: number; folderId: string | null; reason?: string },
): Promise<Outcome<NoteWriteResult>> {
  return writeNote({
    ref,
    now,
    permission: "move",
    action: "note.moved",
    input: { note, ...input },
    note,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    async plan(row, { tx, grant }) {
      if (row.folderId === input.folderId) return null;
      const refused = await lockTargetFolder(tx, grant, input.folderId);
      if (refused) return refused;
      return { change: "moved", folderId: input.folderId };
    },
  });
}
