import {
  type ApiTokenAccessMode,
  type NotePermission,
  type TokenEntryInput,
  tokenAccessProblems,
  type UserRole,
} from "@hexmark/shared";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { apiTokenEntries, folders, notes } from "../../db/schema";
import { type Failure, fail } from "../../lib/outcome";
import { beyondRole } from "../access/note-permissions";
import { refuse } from "../notes/refusals";

// The access a token is given or changed to: the rules that depend on the
// mode (@hexmark/shared, tokenAccessProblems), the owner's role, targets
// that exist, and writing the entries. Used by creating and by changing a
// token, so both refuse the same way.

export interface AccessInput {
  mode: ApiTokenAccessMode;
  basePermissions: NotePermission[] | null;
  entries: readonly TokenEntryInput[];
}

const keyOf = (entry: { kind: string; id: string }) => `${entry.kind}:${entry.id.toLowerCase()}`;

// `kept`: entries the token has already; their target may be in the trash
// (an entry stays while its target is there). A new entry needs a target in
// use, held by a share lock until the transaction ends.
export async function accessRefusal(
  tx: Transaction,
  role: UserRole,
  input: AccessInput,
  kept: ReadonlySet<string> = new Set(),
): Promise<Failure | null> {
  const fields = tokenAccessProblems(input.mode, input.basePermissions, input.entries);
  if (fields) return fail(400, "validation", { fields });
  // A permission the owner's role lacks could never be used.
  const asked = [
    ...(input.basePermissions ?? []),
    ...input.entries.flatMap((entry) => entry.permissions ?? []),
  ];
  const beyond = beyondRole(role, [...new Set(asked)]);
  if (beyond.length > 0) return refuse("forbidden", { permissions: beyond });
  const fresh = input.entries.filter((entry) => !kept.has(keyOf(entry)));
  const ids = (kind: "folder" | "note") =>
    fresh.filter((entry) => entry.kind === kind).map((entry) => entry.id.toLowerCase());
  const folderIds = ids("folder");
  const noteIds = ids("note");
  const liveFolders = folderIds.length
    ? await tx
        .select({ id: folders.id, deletedAt: folders.deletedAt })
        .from(folders)
        .where(inArray(folders.id, folderIds))
        .orderBy(folders.id)
        .for("share")
    : [];
  const liveNotes = noteIds.length
    ? await tx
        .select({ id: notes.id, deletedAt: notes.deletedAt })
        .from(notes)
        .where(inArray(notes.id, noteIds))
        .orderBy(notes.id)
        .for("share")
    : [];
  const live = (rows: { id: string; deletedAt: Date | null }[]) =>
    new Set(rows.filter((row) => row.deletedAt === null).map((row) => row.id));
  const missingFolders = folderIds.filter((id) => !live(liveFolders).has(id));
  if (missingFolders.length > 0) return refuse("folder_not_found", { folderIds: missingFolders });
  const missingNotes = noteIds.filter((id) => !live(liveNotes).has(id));
  if (missingNotes.length > 0) return refuse("not_found", { noteIds: missingNotes });
  return null;
}

function entryRow(tokenId: string, mode: ApiTokenAccessMode, entry: TokenEntryInput, now: Date) {
  const id = entry.id.toLowerCase();
  return {
    tokenId,
    tokenAccessMode: mode,
    targetKind: entry.kind,
    folderId: entry.kind === "folder" ? id : null,
    noteId: entry.kind === "note" ? id : null,
    permissions: mode === "allow_list" ? (entry.permissions ?? null) : null,
    createdAt: now,
  };
}

export async function insertEntries(
  tx: Transaction,
  tokenId: string,
  mode: ApiTokenAccessMode,
  entries: readonly TokenEntryInput[],
  now: Date,
): Promise<void> {
  if (entries.length === 0) return;
  await tx
    .insert(apiTokenEntries)
    .values(entries.map((entry) => entryRow(tokenId, mode, entry, now)));
}

// Replaces a token's entries (same mode): removes what is no longer listed,
// updates permissions that differ, adds what is new. Kept entries keep their
// id and created_at.
export async function replaceEntries(
  tx: Transaction,
  tokenId: string,
  mode: ApiTokenAccessMode,
  entries: readonly TokenEntryInput[],
  now: Date,
): Promise<void> {
  const current = await tx
    .select()
    .from(apiTokenEntries)
    .where(eq(apiTokenEntries.tokenId, tokenId));
  const wanted = new Map(entries.map((entry) => [keyOf(entry), entry]));
  const keep = current.filter((row) =>
    wanted.has(keyOf({ kind: row.targetKind, id: row.folderId ?? row.noteId ?? "" })),
  );
  const keepIds = keep.map((row) => row.id);
  await tx
    .delete(apiTokenEntries)
    .where(
      keepIds.length
        ? and(eq(apiTokenEntries.tokenId, tokenId), notInArray(apiTokenEntries.id, keepIds))
        : eq(apiTokenEntries.tokenId, tokenId),
    );
  const kept = new Set<string>();
  for (const row of keep) {
    const key = keyOf({ kind: row.targetKind, id: row.folderId ?? row.noteId ?? "" });
    kept.add(key);
    const permissions = mode === "allow_list" ? (wanted.get(key)?.permissions ?? null) : null;
    if (JSON.stringify(permissions) !== JSON.stringify(row.permissions)) {
      await tx.update(apiTokenEntries).set({ permissions }).where(eq(apiTokenEntries.id, row.id));
    }
  }
  const added = entries.filter((entry) => !kept.has(keyOf(entry)));
  await insertEntries(tx, tokenId, mode, added, now);
}

export function entryKeys(entries: readonly { kind: string; targetId: string }[]): Set<string> {
  return new Set(entries.map((entry) => keyOf({ kind: entry.kind, id: entry.targetId })));
}
