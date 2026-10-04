import type { ApiTokenEntryInfo, ApiTokenInfo } from "@hexmark/shared";
import { asc, inArray } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import {
  type ApiToken,
  type ApiTokenEntry,
  apiTokenEntries,
  folders,
  notes,
} from "../../db/schema";
import { joinPath, loadFolderIndex } from "../notes/folder-index";

// API tokens as the token API answers them: the row with its entries, each
// entry with the path of its target now (where it was, for a target in the
// trash) and whether it is in the trash. Never the token itself.

export async function entriesOf(
  tx: Transaction,
  tokenIds: readonly string[],
): Promise<ApiTokenEntry[]> {
  if (tokenIds.length === 0) return [];
  return tx
    .select()
    .from(apiTokenEntries)
    .where(inArray(apiTokenEntries.tokenId, [...tokenIds]))
    .orderBy(asc(apiTokenEntries.createdAt), asc(apiTokenEntries.id));
}

// Describes entries; `entries` may belong to several tokens.
export async function describeEntries(
  tx: Transaction,
  entries: readonly ApiTokenEntry[],
): Promise<Map<string, ApiTokenEntryInfo>> {
  const index = await loadFolderIndex(tx, true);
  const noteIds = entries.flatMap((entry) => (entry.noteId ? [entry.noteId] : []));
  const folderIds = entries.flatMap((entry) => (entry.folderId ? [entry.folderId] : []));
  const noteRows = noteIds.length
    ? await tx
        .select({
          id: notes.id,
          title: notes.title,
          folderId: notes.folderId,
          deletedAt: notes.deletedAt,
        })
        .from(notes)
        .where(inArray(notes.id, noteIds))
    : [];
  const folderRows = folderIds.length
    ? await tx
        .select({ id: folders.id, deletedAt: folders.deletedAt })
        .from(folders)
        .where(inArray(folders.id, folderIds))
    : [];
  const noteById = new Map(noteRows.map((row) => [row.id, row]));
  const trashedFolders = new Set(folderRows.filter((row) => row.deletedAt).map((row) => row.id));
  const described = new Map<string, ApiTokenEntryInfo>();
  for (const entry of entries) {
    const note = entry.noteId ? noteById.get(entry.noteId) : undefined;
    const targetId = entry.folderId ?? entry.noteId ?? "";
    described.set(entry.id, {
      id: entry.id,
      kind: entry.targetKind,
      targetId,
      path: note ? joinPath(index.pathOf(note.folderId), note.title) : index.pathOf(targetId),
      targetTrashed: note ? note.deletedAt !== null : trashedFolders.has(targetId),
      permissions: entry.permissions,
    });
  }
  return described;
}

export function tokenInfo(row: ApiToken, entries: ApiTokenEntryInfo[]): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    mode: row.accessMode,
    basePermissions: row.basePermissions,
    entries,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

// Tokens with their entries, in the order given.
export async function tokenInfos(tx: Transaction, rows: readonly ApiToken[]) {
  const entries = await entriesOf(
    tx,
    rows.map((row) => row.id),
  );
  const described = await describeEntries(tx, entries);
  return rows.map((row) =>
    tokenInfo(
      row,
      entries
        .filter((entry) => entry.tokenId === row.id)
        .flatMap((entry) => described.get(entry.id) ?? []),
    ),
  );
}
