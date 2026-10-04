import type { NoteChange, NoteHeader } from "@hexmark/shared";
import { and, eq, getTableColumns, isNotNull, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { type Note, noteRevisions, noteSections, notes } from "../../db/schema";
import type { Actor } from "../access/access";
import { type FolderIndex, joinPath } from "./folder-index";
import { revisionSectionPath } from "./revision-section-path";
import { type ParsedSection, parseSections } from "./sections";

// Reading and writing note rows inside a caller's transaction: locking,
// the revision snapshot of every change and the derived sections.

export type NoteRow = Omit<Note, "search">;

const { search: _noteSearch, ...noteColumns } = getTableColumns(notes);
const { search: _sectionSearch, ...sectionColumns } = getTableColumns(noteSections);

// Rows per insert statement, well below PostgreSQL's parameter limit.
const SECTION_INSERT_CHUNK = 1000;

// The note, locked for the rest of the transaction. Live notes only, unless
// `inTrash` asks for one in the trash (restoring).
export async function lockNote(
  tx: Transaction,
  id: string,
  inTrash = false,
): Promise<NoteRow | undefined> {
  const [row] = await tx
    .select(noteColumns)
    .from(notes)
    .where(and(eq(notes.id, id), inTrash ? isNotNull(notes.deletedAt) : isNull(notes.deletedAt)))
    .for("update");
  return row;
}

export async function readLiveNote(tx: Transaction, id: string): Promise<NoteRow | undefined> {
  const [row] = await tx
    .select(noteColumns)
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
  return row;
}

export function noteHeader(row: NoteRow, index: FolderIndex): NoteHeader {
  const folderPath = index.pathOf(row.folderId);
  return {
    id: row.id,
    title: row.title,
    folderId: row.folderId,
    folderPath,
    path: joinPath(folderPath, row.title),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdByName,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedByName,
  };
}

export function updatedBy(actor: Actor, now: Date) {
  return {
    updatedAt: now,
    updatedByUserId: actor.userId,
    updatedByTokenId: actor.tokenId,
    updatedByName: actor.name,
  };
}

// `sectionPath`: the section a section-level edit changed (full path).
export async function insertRevision(
  tx: Transaction,
  row: NoteRow,
  change: NoteChange,
  reason: string | undefined,
  actor: Actor,
  now: Date,
  sectionPath?: string,
): Promise<void> {
  await tx.insert(noteRevisions).values({
    noteId: row.id,
    version: row.version,
    title: row.title,
    body: row.body,
    folderId: row.folderId,
    metadata: row.metadata,
    change,
    reason: reason ?? null,
    sectionPath: sectionPath === undefined ? null : revisionSectionPath(sectionPath),
    actorUserId: actor.userId,
    actorTokenId: actor.tokenId,
    actorName: actor.name,
    createdAt: now,
  });
}

// Replaces the note's sections with those of its current body. The search
// vector weighs the note's title and the heading (A) above the text (B),
// with the 'simple' configuration like notes.search.
export async function rebuildSections(
  tx: Transaction,
  noteId: string,
  title: string,
  body: string,
): Promise<ParsedSection[]> {
  const sections = parseSections(body);
  await tx.delete(noteSections).where(eq(noteSections.noteId, noteId));
  const rows = sections.map((section) => ({
    noteId,
    position: section.position,
    level: section.level,
    heading: section.heading,
    path: section.path,
    parentPosition: section.parentPosition,
    startOffset: section.startOffset,
    endOffset: section.endOffset,
    subtreeEndOffset: section.subtreeEndOffset,
    characters: section.characters,
    approxTokens: section.approxTokens,
    search: sql`setweight(to_tsvector('simple', ${`${title} ${section.heading}`}), 'A') || setweight(to_tsvector('simple', ${section.searchText}), 'B')`,
  }));
  for (let i = 0; i < rows.length; i += SECTION_INSERT_CHUNK) {
    await tx.insert(noteSections).values(rows.slice(i, i + SECTION_INSERT_CHUNK));
  }
  return sections;
}

export async function readSections(tx: Transaction, noteId: string) {
  return tx
    .select(sectionColumns)
    .from(noteSections)
    .where(eq(noteSections.noteId, noteId))
    .orderBy(noteSections.position);
}
