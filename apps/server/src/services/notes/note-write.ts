import type {
  AuditAction,
  NoteChange,
  NotePermission,
  NoteWriteResult,
  WriteWarning,
} from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { sectionTokenBudget } from "../../config/notes";
import type { Transaction } from "../../db/client";
import { notes } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize, type Grant, noteRefusal } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import { noteWriteRefusal } from "../locks/lock-guard";
import type { TrashMark } from "../trash/trash-store";
import { isUuid, type NoteRef, resolveNoteRef } from "./addressing";
import { type FolderIndex, joinPath } from "./folder-index";
import { type NoteChangeFacts, noteChangeEvent } from "./note-events";
import {
  insertRevision,
  lockNote,
  type NoteRow,
  readLiveNote,
  rebuildSections,
  updatedBy,
} from "./note-store";
import { isFailure, refuse } from "./refusals";
import type { ParsedSection } from "./sections";
import { type ConflictSection, guardTitle, versionConflict } from "./write-refusals";

// The one path every change of an existing note takes, in one transaction:
// authorize, lock the note's row, check the permission on it, its hidden
// mark and its lock (agents cannot change hidden or locked notes; checked
// before the version, so a refusal tells nothing of the content), compare
// the version the client based
// its change on, apply the change, raise the version, write the revision
// snapshot and rebuild the sections.

// Into the trash or out of it: all trash columns together (trash-store.ts).
export interface NoteEdit extends Partial<TrashMark> {
  change: NoteChange;
  title?: string;
  body?: string;
  folderId?: string | null;
  // Section-level edits: the full path of the section changed, for the
  // revision (shortened there when very long).
  sectionPath?: string;
}

export interface WriteContext {
  tx: Transaction;
  grant: Grant;
  index: FolderIndex;
}

export interface NoteWriteRequest {
  ref: AccessRef;
  now: Date;
  permission: NotePermission;
  // How the audit log names the change, and the input as sent (summarized
  // there for a failure).
  action: AuditAction;
  input: unknown;
  note: NoteRef;
  // Null only for restoring from the trash, which has no version to check.
  expectedVersion: number | null;
  reason: string | undefined;
  inTrash?: boolean;
  // Section writes: the section to show with a version conflict.
  conflictSection?: ConflictSection;
  // The change to make; null when it would change nothing.
  plan(row: NoteRow, context: WriteContext): Promise<NoteEdit | null | Failure>;
}

export function overBudgetWarnings(sections: readonly ParsedSection[]): WriteWarning[] {
  return sections
    .filter((section) => section.ownApproxTokens > sectionTokenBudget)
    .map((section) => ({
      code: "section_over_budget",
      path: section.path,
      approxTokens: section.ownApproxTokens,
      budget: sectionTokenBudget,
      message:
        `Section "${section.path}" exceeds the reading budget; split it with more headings ` +
        "or read it in chunks with offset/limit.",
    }));
}

// Sent with changed: false, so a client does not take the missing new
// version for a lost write.
export const UNCHANGED_MESSAGE =
  "Nothing differs from the current version; no revision was created and the reason was dropped.";

export function writeResult(
  row: NoteRow,
  index: FolderIndex,
  changed: boolean,
  warnings: WriteWarning[] = [],
): NoteWriteResult {
  const folderPath = index.pathOf(row.folderId);
  return {
    id: row.id,
    version: row.version,
    changed,
    updatedAt: row.updatedAt.toISOString(),
    folderPath,
    path: joinPath(folderPath, row.title),
    warnings,
    ...(changed ? {} : { message: UNCHANGED_MESSAGE }),
  };
}

async function lockTarget(
  context: WriteContext,
  request: NoteWriteRequest,
): Promise<NoteRow | Failure> {
  const { tx, grant, index } = context;
  let id: string | Failure;
  if (request.inTrash) {
    id = "id" in request.note && isUuid(request.note.id) ? request.note.id : refuse("not_found");
  } else id = await resolveNoteRef(tx, grant, index, request.note);
  if (isFailure(id)) return id;
  const row = await lockNote(tx, id, request.inTrash);
  // A note in the trash is judged by the folders it lay in, which may be in
  // the trash with it.
  const view = request.inTrash ? await grant.trashView() : grant.view;
  if (!row || !view.seesNote(row)) {
    const live = request.inTrash ? await readLiveNote(tx, id) : undefined;
    return live && grant.view.seesNote(live) ? refuse("note_not_deleted") : refuse("not_found");
  }
  return (
    noteRefusal(view, row, request.permission) ??
    (await noteWriteRefusal(tx, grant, row, request.permission, view)) ??
    row
  );
}

export function writeNote(request: NoteWriteRequest): Promise<Outcome<NoteWriteResult>> {
  const { ref, action, input } = request;
  return runAudited({ ref, action, input }, async (tx) => {
    const grant = await authorize(tx, request.ref, request.now, request.permission);
    if (isFailure(grant)) return grant;
    const context: WriteContext = { tx, grant, index: grant.index };
    const row = await lockTarget(context, request);
    if (isFailure(row)) return row;
    if (request.expectedVersion !== null && row.version !== request.expectedVersion) {
      return versionConflict(tx, row, request.conflictSection);
    }
    const edit = await request.plan(row, context);
    if (isFailure(edit)) return edit;
    const log = (after: NoteRow, facts: NoteChangeFacts) =>
      recordAccessEvent(
        tx,
        grant.access,
        noteChangeEvent(action, row, after, context.index, facts, request.reason),
        request.now,
      );
    if (edit === null) {
      await log(row, { change: null });
      return writeResult(row, context.index, false);
    }
    const { change, sectionPath, ...fields } = edit;
    const changes = {
      ...fields,
      version: row.version + 1,
      ...updatedBy(grant.access.actor, request.now),
    };
    const next: NoteRow = { ...row, ...changes };
    // Title and folder may now clash with another note's (unique index).
    const updated = await guardTitle(tx, grant.view, next, (savepoint) =>
      savepoint.update(notes).set(changes).where(eq(notes.id, row.id)),
    );
    if (isFailure(updated)) return updated;
    await insertRevision(
      tx,
      next,
      change,
      request.reason,
      grant.access.actor,
      request.now,
      sectionPath,
    );
    await log(next, { change, sectionPath, batchId: edit.trashBatchId ?? row.trashBatchId });
    if (next.title === row.title && next.body === row.body) {
      return writeResult(next, context.index, true);
    }
    const sections = await rebuildSections(tx, next.id, next.title, next.body);
    const warnings = next.body === row.body ? [] : overBudgetWarnings(sections);
    return writeResult(next, context.index, true, warnings);
  });
}
