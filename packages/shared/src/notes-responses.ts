import type { HiddenState } from "./hidden.ts";
import type { LockState } from "./locks.ts";
import type { NoteChange } from "./notes";

// Shapes of the /api/notes/v1 answers (apps/server/src/api/notes/v1/index.ts).
// The MCP tools return the same objects. Timestamps are ISO 8601 strings.
//
// Paths: a folder's path joins the names from the root with "/"
// ("Projects/Web"; "" for the root level); a note's path adds its title
// ("Projects/Web/Naming conventions").

export interface NoteHeader {
  id: string;
  title: string;
  // Null for the root level, and for a token when the folder lies outside
  // what it can reach (a note listed on its own); folderPath still names it.
  folderId: string | null;
  folderPath: string;
  path: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  // Null when neither the note nor a folder above it is locked.
  locked: LockState | null;
  // Null when neither the note nor a folder above it is hidden.
  hidden: HiddenState | null;
}

export interface FullNote extends NoteHeader {
  body: string;
  metadata: Record<string, unknown>;
  // Size of the whole body in characters (code points), and its estimate in
  // tokens (UTF-8 bytes / 4).
  characters: number;
  approxTokens: number;
}

export interface OutlineSection {
  position: number;
  // 0: text before the first heading; 1-6: heading level.
  level: number;
  heading: string;
  path: string;
  parentPosition: number | null;
  // Including subsections; tokens are an estimate (UTF-8 bytes / 4).
  characters: number;
  approxTokens: number;
  // approxTokens exceeds the reading budget: read the subsections one by one.
  overBudget: boolean;
}

export interface SectionText {
  path: string;
  level: number;
  heading: string;
  includesSubsections: boolean;
  // From the heading line on, as written in the body; with offset/limit the
  // requested piece of it.
  text: string;
  // Size of `text` (the piece, when reading in pieces).
  characters: number;
  approxTokens: number;
  // Reading in pieces, in characters (code points): where `text` starts in
  // the section, how long it is, how long the section is, and where the next
  // piece starts (null when `text` reaches the end).
  offset: number;
  returned: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  // Only when the requested offset is at or past the section's end: a short
  // English notice saying so (the piece is empty then).
  notice?: string;
  // Only when the requested offset is past the end: the offset as requested
  // (`offset` is then the section's end).
  requestedOffset?: number;
}

export interface TreeNote {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  // Who wrote the current version (username or token name) and what it
  // changed.
  updatedBy: string;
  lastChange: NoteChange;
  locked: LockState | null;
  hidden: HiddenState | null;
  // Only for a note listed at the top of a listing because its own folder is
  // not visible to the token (a single note on an allow_list).
  folderPath?: string;
}

// A folder in a listing. Where the requested depth ends its contents are not
// loaded: `loaded` is false and only the counts say what it holds. A hidden
// folder shown to an agent is never loaded and has no counts (null): what
// lies below it does not exist for agents.
export type TreeFolder = {
  id: string;
  name: string;
  path: string;
  // Subfolders and notes directly inside (notes visible to the caller).
  folderCount: number | null;
  noteCount: number | null;
  locked: LockState | null;
  hidden: HiddenState | null;
} & ({ loaded: true; folders: TreeFolder[]; notes: TreeNote[] } | { loaded: false });

export interface TreeResponse {
  // The folder listed, or null for the root level (for a token that cannot
  // see the whole root level: the topmost folders and notes it may see).
  folder: {
    id: string;
    name: string;
    path: string;
    locked: LockState | null;
    hidden: HiddenState | null;
  } | null;
  folders: TreeFolder[];
  notes: TreeNote[];
}

export interface WriteWarning {
  code: "section_over_budget";
  path: string;
  approxTokens: number;
  budget: number;
  // A short English hint (codes stay the contract).
  message: string;
}

// Answer of every note write. `changed` is false when the write would not
// change anything (no new version is written then). Paths as in NoteHeader.
export interface NoteWriteResult {
  id: string;
  version: number;
  changed: boolean;
  updatedAt: string;
  folderPath: string;
  path: string;
  warnings: WriteWarning[];
  // Only with changed: false, a short English note that nothing was written.
  message?: string;
}

export interface FolderResult {
  id: string;
  name: string;
  // Null for the root level, and when the parent lies outside the token's
  // folders (parentOutsideScope).
  parentId: string | null;
  parentOutsideScope: boolean;
  path: string;
}

// A hit in a note an agent cannot read (hidden) matched its title only: no
// section (sectionPath and heading null), an empty snippet, and `hidden` set.
export interface SearchHit {
  noteId: string;
  title: string;
  // As in NoteHeader: null at the root level and for a folder out of reach.
  folderId: string | null;
  folderPath: string;
  sectionPath: string | null;
  // The section's heading as written, without match marks; "" for the text
  // before the first heading.
  heading: string | null;
  // The section's text without its heading line, matches marked «like
  // this» (a phrase as one mark), "…" where text is left out.
  snippet: string;
  hidden: HiddenState | null;
  version: number;
  // Relevance relative to the best hit of the same search: 1 for the best,
  // between 0 and 1 for the others, three decimals.
  rank: number;
}

export interface ChangeEntry {
  noteId: string;
  title: string;
  folderPath: string;
  version: number;
  // The latest change since the given time, and how many there were.
  change: NoteChange;
  changes: number;
  actorName: string;
  reason: string | null;
  // The section the latest change edited (replace_section); null otherwise,
  // and for agents when the note is hidden (headings are its content).
  sectionPath: string | null;
  changedAt: string;
  deleted: boolean;
  // As in NoteHeader: null, or the lock or hidden mark of the note or of the
  // nearest folder above it.
  locked: LockState | null;
  hidden: HiddenState | null;
}

export interface RevisionSummary {
  version: number;
  change: NoteChange;
  reason: string | null;
  actorName: string;
  createdAt: string;
  title: string;
  // The folder the note was in; null for the root level, and when that folder
  // lies outside the token's folders (folderOutsideScope).
  folderId: string | null;
  // Current path of that folder; null when it no longer exists or lies
  // outside the token's folders.
  folderPath: string | null;
  // True when that folder (or the root level) is outside the token's folders;
  // for such a token also when the folder no longer exists.
  folderOutsideScope: boolean;
  // The one section a section-level edit changed, as its path was then
  // (shortened at the front to "… > " when very long); null for changes of
  // the whole note and for revisions recorded before sections were tracked,
  // and for agents when the note is hidden (headings are its content).
  sectionPath: string | null;
}

export interface RevisionSnapshot extends RevisionSummary {
  // The note this version belongs to.
  noteId: string;
  body: string;
  metadata: Record<string, unknown>;
}

// Details of 409 version_conflict.
export interface VersionConflictDetails {
  currentVersion: number;
  updatedAt: string;
  updatedBy: string;
  // Section writes only: the section's current text, null when it is gone.
  currentSection?: { path: string; text: string } | null;
  // What the current version changed, so a client can judge whether its own
  // change is affected.
  lastChange: { change: NoteChange; reason: string | null; sectionPath: string | null };
}

// Details of 409 title_taken: the note that holds the title. Its id is null
// when that note lies out of the token's reach (excluded on its own).
export interface TitleTakenDetails {
  existingNoteId: string | null;
  path: string;
}

// Details of 409 name_taken: the folder in use that holds the name there. Its
// id is null when that folder lies out of the token's reach.
export interface NameTakenDetails {
  existingFolderId: string | null;
  path: string;
}

export interface NoteCandidate {
  id: string;
  path: string;
}
