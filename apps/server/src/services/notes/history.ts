import type { ChangeEntry, RevisionSnapshot, RevisionSummary } from "@hexmark/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { type NoteRevision, noteRevisions } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { AuditTarget } from "../audit/record";
import { noteHiddenState } from "../hidden/hidden-state";
import { isAgent } from "../locks/lock-guard";
import { noteLockState } from "../locks/lock-state";
import type { NoteRef } from "./addressing";
import { joinPath } from "./folder-index";
import { findNote, findNoteContent, noteTarget, type ReadContext, withRead } from "./read-frame";
import { isFailure, refuse } from "./refusals";
import { showFolder } from "./scoped-folder";

// What changed: notes changed since a time, and a note's revisions.

interface ChangeRow extends Record<string, unknown> {
  note_id: string;
  title: string;
  folder_id: string | null;
  version: number;
  change: ChangeEntry["change"];
  changes: number;
  actor_name: string;
  reason: string | null;
  section_path: string | null;
  changed_at: Date | string;
  deleted: boolean;
  hidden_at: Date | string | null;
  hidden_by_name: string | null;
  hide_reason: string | null;
  locked_at: Date | string | null;
  locked_by_name: string | null;
  lock_reason: string | null;
}

const asDate = (value: Date | string | null) => (value === null ? null : new Date(value));

// One entry per note (its latest change after `since`, and how many there
// were), newest first, of the notes the caller may read. Notes in the trash
// are listed with deleted: true and the path they had, also when their
// folder is in the trash with them (judged by the folders they lay in). Lock
// and hidden state as every read shows them. An agent never sees the section
// a hidden note's change edited: headings are its content.
export function listChanges(
  ref: AccessRef,
  now: Date,
  input: { since: Date; limit: number },
): Promise<Outcome<ChangeEntry[]>> {
  const request = { ref, now, permission: "read", action: "read.changes", input } as const;
  return withRead(
    request,
    async ({ tx, grant }) => {
      const view = await grant.trashView();
      const visible = view.noteSql("read", sql`n.id`, sql`n.folder_id`);
      const { index } = view;
      const rows = await tx.execute<ChangeRow>(sql`
      select * from (
        select distinct on (r.note_id) r.note_id, n.title, n.folder_id, n.version, r.change,
          count(*) over (partition by r.note_id)::int as changes, r.actor_name, r.reason,
          r.section_path, r.created_at as changed_at, n.deleted_at is not null as deleted,
          n.hidden_at, n.hidden_by_name, n.hide_reason,
          n.locked_at, n.locked_by_name, n.lock_reason
        from note_revisions r
        join notes n on n.id = r.note_id
        where r.created_at > ${input.since.toISOString()}::timestamptz
          and ${visible}
        order by r.note_id, r.version desc
      ) latest
      order by changed_at desc
      limit ${input.limit}
    `);
      const agent = isAgent(grant);
      return rows.map((row) => {
        const note = {
          id: row.note_id,
          title: row.title,
          folderId: row.folder_id,
          hiddenAt: asDate(row.hidden_at),
          hiddenByName: row.hidden_by_name,
          hideReason: row.hide_reason,
          lockedAt: asDate(row.locked_at),
          lockedByName: row.locked_by_name,
          lockReason: row.lock_reason,
        };
        return {
          noteId: row.note_id,
          title: row.title,
          folderPath: index.pathOf(row.folder_id),
          version: row.version,
          change: row.change,
          changes: row.changes,
          actorName: row.actor_name,
          reason: row.reason,
          sectionPath: agent && row.hidden_at !== null ? null : row.section_path,
          changedAt: new Date(row.changed_at).toISOString(),
          deleted: row.deleted,
          locked: noteLockState(view, note),
          hidden: noteHiddenState(view, note),
        };
      });
    },
    (changes) => ({ details: { changeCount: changes.length } }),
  );
}

// The folder the note was in at that version, as far as the caller may know
// it (scoped-folder.ts). `hidden`: the note is hidden from the caller's
// eyes (an agent's), so the section an edit changed is not named.
function summary(row: NoteRevision, context: ReadContext, hidden = false): RevisionSummary {
  return {
    version: row.version,
    change: row.change,
    reason: row.reason,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    ...showFolder(context.grant, context.index, row.folderId),
    sectionPath: hidden ? null : row.sectionPath,
  };
}

export function listRevisions(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
): Promise<Outcome<{ noteId: string; path: string; revisions: RevisionSummary[] }>> {
  const request = {
    ref,
    now,
    permission: "read",
    action: "read.revisions",
    input: { note },
  } as const;
  return withRead(
    request,
    async (context) => {
      const row = await findNote(context, note);
      if (isFailure(row)) return row;
      const revisions = await context.tx
        .select()
        .from(noteRevisions)
        .where(eq(noteRevisions.noteId, row.id))
        .orderBy(desc(noteRevisions.version));
      const path = joinPath(context.index.pathOf(row.folderId), row.title);
      const hidden = isAgent(context.grant) && row.hiddenAt !== null;
      return {
        noteId: row.id,
        path,
        revisions: revisions.map((revision) => summary(revision, context, hidden)),
      };
    },
    (listing) => ({
      target: { kind: "note", id: listing.noteId, label: listing.path },
      details: { revisionCount: listing.revisions.length },
    }),
  );
}

export function readRevision(
  ref: AccessRef,
  now: Date,
  note: NoteRef,
  version: number,
): Promise<Outcome<RevisionSnapshot>> {
  const input = { note, version };
  const request = { ref, now, permission: "read", action: "read.revision", input } as const;
  let target: AuditTarget | null = null;
  return withRead(
    request,
    async (context) => {
      const row = await findNoteContent(context, note);
      if (isFailure(row)) return row;
      target = noteTarget(row, context.index);
      const [revision] = await context.tx
        .select()
        .from(noteRevisions)
        .where(and(eq(noteRevisions.noteId, row.id), eq(noteRevisions.version, version)));
      if (!revision) return refuse("not_found");
      return {
        noteId: row.id,
        ...summary(revision, context),
        body: revision.body,
        metadata: revision.metadata,
      };
    },
    (snapshot) => ({ target, details: { version: snapshot.version } }),
  );
}
