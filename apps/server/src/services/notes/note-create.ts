import type { NoteWriteResult } from "@hexmark/shared";
import { and, eq, getTableColumns, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize, type Grant, requireFolder } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { missingFolder } from "../trash/in-trash";
import { loadFolderIndex } from "./folder-index";
import { noteCreatedEvent } from "./note-events";
import { insertRevision, rebuildSections } from "./note-store";
import { overBudgetWarnings, writeResult } from "./note-write";
import { isFailure } from "./refusals";
import { guardTitle } from "./write-refusals";

// Creating a note: version 1 with its first revision ("created") and its
// sections, in one transaction.

export interface NewNote {
  folderId: string | null;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  reason?: string;
}

const { search: _search, ...noteColumns } = getTableColumns(notes);

// The target folder must exist, be visible to the caller and stay until the
// transaction ends (a share lock keeps it from being deleted meanwhile); one
// in the trash is refused with folder_in_trash.
export async function lockTargetFolder(
  tx: Transaction,
  grant: Grant,
  folderId: string | null,
): Promise<Failure | null> {
  if (folderId !== null) {
    const [folder] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)))
      .for("share");
    if (!folder) return missingFolder(tx, grant, folderId);
  }
  return requireFolder(grant, folderId);
}

export function createNote(
  ref: AccessRef,
  now: Date,
  input: NewNote,
): Promise<Outcome<NoteWriteResult>> {
  return runAudited({ ref, action: "note.created", input }, async (tx) => {
    const grant = await authorize(tx, ref, now, "create");
    if (isFailure(grant)) return grant;
    const refused = await lockTargetFolder(tx, grant, input.folderId);
    if (refused) return refused;
    const { actor } = grant.access;
    const index = await loadFolderIndex(tx);
    const inserted = await guardTitle(tx, index, input, (savepoint) =>
      savepoint
        .insert(notes)
        .values({
          folderId: input.folderId,
          title: input.title,
          body: input.body,
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
          createdByUserId: actor.userId,
          createdByTokenId: actor.tokenId,
          createdByName: actor.name,
          updatedByUserId: actor.userId,
          updatedByTokenId: actor.tokenId,
          updatedByName: actor.name,
        })
        .returning(noteColumns),
    );
    if (isFailure(inserted)) return inserted;
    const [row] = inserted;
    if (!row) throw new Error("the note was not inserted");
    await insertRevision(tx, row, "created", input.reason, actor, now);
    await recordAccessEvent(tx, grant.access, noteCreatedEvent(row, index, input.reason), now);
    const sections = await rebuildSections(tx, row.id, row.title, row.body);
    return writeResult(row, index, true, overBudgetWarnings(sections));
  });
}
