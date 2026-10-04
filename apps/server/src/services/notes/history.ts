import type { ChangeEntry, RevisionSnapshot, RevisionSummary } from "@hexmark/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { type NoteRevision, noteRevisions } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import type { AuditTarget } from "../audit/record";
import { trashScope } from "../trash/trash-store";
import type { NoteRef } from "./addressing";
import { joinPath, loadFolderIndex } from "./folder-index";
import { findNote, noteTarget, type ReadContext, withRead } from "./read-frame";
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
}

// One entry per note (its latest change after `since`, and how many there
// were), newest first. Notes in the trash are listed with deleted: true and
// the path they had, also when their folder is in the trash with them.
export function listChanges(
  ref: AccessRef,
  now: Date,
  input: { since: Date; limit: number },
): Promise<Outcome<ChangeEntry[]>> {
  const request = { ref, now, permission: "read", action: "read.changes", input } as const;
  return withRead(
    request,
    async ({ tx, grant }) => {
      const scope = await trashScope(tx, grant);
      const visible =
        scope === null ? sql`true` : sql`n.folder_id = any(${sql.param([...scope])}::uuid[])`;
      const index = await loadFolderIndex(tx, true);
      const rows = await tx.execute<ChangeRow>(sql`
      select * from (
        select distinct on (r.note_id) r.note_id, n.title, n.folder_id, n.version, r.change,
          count(*) over (partition by r.note_id)::int as changes, r.actor_name, r.reason,
          r.section_path, r.created_at as changed_at, n.deleted_at is not null as deleted
        from note_revisions r
        join notes n on n.id = r.note_id
        where r.created_at > ${input.since.toISOString()}::timestamptz
          and ${visible}
        order by r.note_id, r.version desc
      ) latest
      order by changed_at desc
      limit ${input.limit}
    `);
      return rows.map((row) => ({
        noteId: row.note_id,
        title: row.title,
        folderPath: index.pathOf(row.folder_id),
        version: row.version,
        change: row.change,
        changes: row.changes,
        actorName: row.actor_name,
        reason: row.reason,
        sectionPath: row.section_path,
        changedAt: new Date(row.changed_at).toISOString(),
        deleted: row.deleted,
      }));
    },
    (changes) => ({ details: { changeCount: changes.length } }),
  );
}

// The folder the note was in at that version, as far as the caller may know
// it (scoped-folder.ts).
function summary(row: NoteRevision, context: ReadContext): RevisionSummary {
  return {
    version: row.version,
    change: row.change,
    reason: row.reason,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    ...showFolder(context.grant, context.index, row.folderId),
    sectionPath: row.sectionPath,
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
      return {
        noteId: row.id,
        path,
        revisions: revisions.map((revision) => summary(revision, context)),
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
      const row = await findNote(context, note);
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
