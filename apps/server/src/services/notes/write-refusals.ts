import type { TitleTakenDetails, VersionConflictDetails } from "@hexmark/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { noteRevisions, notes } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import type { AccessView } from "../access/access-view";
import { joinPath } from "./folder-index";
import type { NoteRow } from "./note-store";
import { readSections } from "./note-store";
import { refuse } from "./refusals";
import { findSection, sectionText } from "./section-lookup";
import { CONSTRAINT_REFUSALS, constraintOf } from "./transaction";

// The two refusals of a note write that carry what the client needs to go
// on: version_conflict (what the current version changed) and title_taken
// (which note holds the title). Both are decided inside the write's
// transaction, on the locked note row or by the unique index.

// The section a section write named, to show with a version conflict.
export interface ConflictSection {
  path: string;
  includeSubsections: boolean;
}

export async function versionConflict(
  tx: Transaction,
  row: NoteRow,
  section: ConflictSection | undefined,
): Promise<Failure> {
  const [latest] = await tx
    .select({
      change: noteRevisions.change,
      reason: noteRevisions.reason,
      sectionPath: noteRevisions.sectionPath,
    })
    .from(noteRevisions)
    .where(and(eq(noteRevisions.noteId, row.id), eq(noteRevisions.version, row.version)));
  const details: VersionConflictDetails = {
    currentVersion: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedByName,
    // Every version has its revision; the fallback only keeps the shape.
    lastChange: latest ?? { change: "edited", reason: null, sectionPath: null },
  };
  if (section) {
    const match = findSection(await readSections(tx, row.id), section.path);
    details.currentSection =
      "found" in match
        ? {
            path: match.found.path,
            text: sectionText(row.body, match.found, section.includeSubsections),
          }
        : null;
  }
  return refuse("version_conflict", { ...details });
}

function isTitleClash(error: unknown): boolean {
  const constraint = constraintOf(error);
  return constraint !== undefined && CONSTRAINT_REFUSALS[constraint] === "title_taken";
}

// Runs `write` (which may give a note a title in a folder) in a savepoint.
// When the folder's unique title index refuses it, the transaction goes on
// and the answer is title_taken naming the note that holds the title. It lies
// in the folder the caller is writing to, yet may be out of the caller's
// reach (a note excluded on its own): then its id is not named.
export async function guardTitle<T>(
  tx: Transaction,
  view: AccessView,
  target: { folderId: string | null; title: string },
  write: (savepoint: Transaction) => Promise<T>,
): Promise<T | Failure> {
  try {
    return await tx.transaction(write);
  } catch (error) {
    if (!isTitleClash(error)) throw error;
    const [holder] = await tx
      .select({ id: notes.id, title: notes.title, folderId: notes.folderId })
      .from(notes)
      .where(
        and(
          isNull(notes.deletedAt),
          sql`${notes.folderId} is not distinct from ${target.folderId}::uuid`,
          sql`lower(${notes.title}) = lower(${target.title}::text)`,
        ),
      );
    if (!holder) return refuse("title_taken");
    const details: TitleTakenDetails = {
      existingNoteId: view.shownNoteId(holder),
      path: joinPath(view.index.pathOf(target.folderId), holder.title),
    };
    return refuse("title_taken", { ...details });
  }
}
