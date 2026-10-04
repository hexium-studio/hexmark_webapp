import type { HideResult } from "@hexmark/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders, notes } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef, Actor } from "../access/access";
import { chainRefusal, folderRefusal, type Grant, noteRefusal } from "../access/authorize";
import { hiddenOf, lockedChain } from "../locks/lock-guard";
import { isUuid, type NoteRef, resolveNoteRef } from "../notes/addressing";
import { type FolderHidden, joinPath } from "../notes/folder-index";
import { lockNote as lockNoteRow } from "../notes/note-store";
import { isFailure, refuse } from "../notes/refusals";
import { missingFolder } from "../trash/in-trash";
import { folderHiddenStateWith, noteHiddenState, ownHidden } from "./hidden-state";
import { changeHidden, type HideSubject } from "./hide-change";

// Hiding and unhiding a note or a folder (hide-change.ts decides). A hidden
// folder hides everything below it from agents, also what is created there
// later. Hiding is not a change of content: no new version, no revision;
// the audit log records it. Only notes and folders in use can be hidden.
//
// The row is locked for update, the folders above it for share (also for
// people: a folder going to the trash then sees every hidden mark below
// it). The permission is decided again on those rows: a folder above may
// have been hidden meanwhile, which makes the item disappear for an agent.

function hiddenValues(mark: FolderHidden | null, actor: Actor) {
  return {
    hiddenAt: mark?.at ?? null,
    hiddenByUserId: mark ? actor.userId : null,
    hiddenByTokenId: mark ? actor.tokenId : null,
    hiddenByName: mark?.byName ?? null,
    hideReason: mark?.reason ?? null,
  };
}

const asColumns = (mark: FolderHidden | null) => ({
  hiddenAt: mark?.at ?? null,
  hiddenByName: mark?.byName ?? null,
  hideReason: mark?.reason ?? null,
});

async function findNote(
  tx: Transaction,
  grant: Grant,
  note: NoteRef,
): Promise<HideSubject | Failure> {
  const id = await resolveNoteRef(tx, grant, grant.index, note);
  if (isFailure(id)) return id;
  const row = await lockNoteRow(tx, id);
  if (!row || !grant.view.seesNote(row)) return refuse("not_found");
  const rows = await lockedChain(tx, row.folderId);
  const chain = rows.map((entry) => entry.id);
  const refused =
    noteRefusal(grant.view, row, "hide") ??
    chainRefusal(grant.access.policy, { kind: "note", id: row.id }, chain, hiddenOf(rows), "hide");
  if (refused) return refused;
  return {
    kind: "note",
    id: row.id,
    path: joinPath(grant.index.pathOf(row.folderId), row.title),
    own: ownHidden(row),
    write: async (writer, mark, { access }) => {
      await writer.update(notes).set(hiddenValues(mark, access.actor)).where(eq(notes.id, row.id));
    },
    state: (view, own) => noteHiddenState(view, { ...row, ...asColumns(own) }),
  };
}

async function findFolder(
  tx: Transaction,
  grant: Grant,
  id: string,
): Promise<HideSubject | Failure> {
  if (!isUuid(id)) return refuse("folder_not_found");
  const [row] = await tx
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
    .for("update");
  if (!row) return missingFolder(tx, grant, id);
  const rows = await lockedChain(tx, row.parentId);
  const chain = [row.id, ...rows.map((entry) => entry.id)];
  const refused =
    folderRefusal(grant.view, row.id, "hide") ??
    chainRefusal(grant.access.policy, { kind: "folder" }, chain, hiddenOf(rows), "hide");
  if (refused) return refused;
  return {
    kind: "folder",
    id: row.id,
    path: grant.index.pathOf(row.id),
    own: ownHidden(row),
    write: async (writer, mark, { access }) => {
      await writer
        .update(folders)
        .set(hiddenValues(mark, access.actor))
        .where(eq(folders.id, row.id));
    },
    state: (view, own) => folderHiddenStateWith(view, row, own),
  };
}

type Input = { reason?: string };

export function hideNote(ref: AccessRef, now: Date, note: NoteRef, input: Input) {
  const find = (tx: Transaction, grant: Grant) => findNote(tx, grant, note);
  return changeHidden({
    ref,
    now,
    action: "note.hidden",
    hide: true,
    input: { note, ...input },
    find,
  });
}

export function unhideNote(ref: AccessRef, now: Date, note: NoteRef, input: Input) {
  const find = (tx: Transaction, grant: Grant) => findNote(tx, grant, note);
  return changeHidden({
    ref,
    now,
    action: "note.unhidden",
    hide: false,
    input: { note, ...input },
    find,
  });
}

export function hideFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: Input,
): Promise<Outcome<HideResult>> {
  const find = (tx: Transaction, grant: Grant) => findFolder(tx, grant, id);
  return changeHidden({
    ref,
    now,
    action: "folder.hidden",
    hide: true,
    input: { id, ...input },
    find,
  });
}

export function unhideFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: Input,
): Promise<Outcome<HideResult>> {
  const find = (tx: Transaction, grant: Grant) => findFolder(tx, grant, id);
  return changeHidden({
    ref,
    now,
    action: "folder.unhidden",
    hide: false,
    input: { id, ...input },
    find,
  });
}
