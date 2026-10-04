import { PATH_SEPARATOR } from "@hexmark/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { notes } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { canSeeFolder, type Grant, visibleFolderSql } from "../access/authorize";
import { inTrashRefusal } from "../trash/in-trash";
import { type FolderIndex, joinPath } from "./folder-index";
import { refuse } from "./refusals";

// Finding a note by what a client calls it: its id, its title, or its folder
// path and title ("Projects/Naming conventions"; "/Title" for the root
// level). Titles never contain "/", so the last segment is the title.
// Notes outside the caller's folders are not found, as if they did not exist.
// Notes in the trash are never found by title or path; named by their id
// they are refused with in_trash (services/trash/in-trash.ts).

export type NoteAddress =
  | { kind: "id"; id: string }
  // folders: names from the root; null when only the title was given.
  | { kind: "path"; folders: string[] | null; title: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checked before an id reaches a query: PostgreSQL refuses a malformed uuid
// with an error that would abort the transaction.
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// Pure: how the input is meant. A UUID is taken as an id first (resolveNote
// falls back to a title of that text).
export function parseNoteAddress(input: string): NoteAddress {
  const value = input.trim();
  if (UUID.test(value)) return { kind: "id", id: value.toLowerCase() };
  if (!value.includes(PATH_SEPARATOR)) return { kind: "path", folders: null, title: value };
  const segments = value.split(PATH_SEPARATOR).map((segment) => segment.trim());
  const title = segments.pop() ?? "";
  return { kind: "path", folders: segments.filter((segment) => segment !== ""), title };
}

// Most candidates listed with ambiguous_note.
const MAX_CANDIDATES = 20;

async function byId(tx: Transaction, grant: Grant, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: notes.id, folderId: notes.folderId })
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
  return row && canSeeFolder(grant, row.folderId) ? row.id : null;
}

async function byTitle(
  tx: Transaction,
  grant: Grant,
  index: FolderIndex,
  address: Extract<NoteAddress, { kind: "path" }>,
): Promise<string | Failure> {
  let folderCondition = sql`true`;
  if (address.folders !== null) {
    const folderId = index.findByNames(address.folders);
    if (folderId === undefined) return refuse("not_found");
    folderCondition =
      folderId === null ? isNull(notes.folderId) : sql`${notes.folderId} = ${folderId}`;
  }
  const rows = await tx
    .select({ id: notes.id, title: notes.title, folderId: notes.folderId })
    .from(notes)
    .where(
      and(
        sql`lower(${notes.title}) = lower(${address.title})`,
        isNull(notes.deletedAt),
        folderCondition,
        visibleFolderSql(grant, notes.folderId),
      ),
    )
    .limit(MAX_CANDIDATES + 1);
  const [first] = rows;
  if (!first) return refuse("not_found");
  if (rows.length === 1) return first.id;
  const candidates = rows
    .slice(0, MAX_CANDIDATES)
    .map((row) => ({ id: row.id, path: joinPath(index.pathOf(row.folderId), row.title) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return refuse("ambiguous_note", { candidates });
}

// The id of the live, visible note the input names.
export async function resolveNote(
  tx: Transaction,
  grant: Grant,
  index: FolderIndex,
  input: string,
): Promise<string | Failure> {
  const address = parseNoteAddress(input);
  if (address.kind === "id") {
    const found = await byId(tx, grant, address.id);
    if (found) return found;
    const titled = await byTitle(tx, grant, index, {
      kind: "path",
      folders: null,
      title: input.trim(),
    });
    if (typeof titled === "string" || titled.error !== "not_found") return titled;
    return (await inTrashRefusal(tx, grant, address.id)) ?? titled;
  }
  return byTitle(tx, grant, index, address);
}

// How services are told which note: by id (HTTP API) or by any address an
// agent may use (MCP tools).
export type NoteRef = { id: string } | { address: string };

export async function resolveNoteRef(
  tx: Transaction,
  grant: Grant,
  index: FolderIndex,
  ref: NoteRef,
): Promise<string | Failure> {
  if ("address" in ref) return resolveNote(tx, grant, index, ref.address);
  if (!UUID.test(ref.id)) return refuse("not_found");
  const id = ref.id.toLowerCase();
  return (
    (await byId(tx, grant, id)) ?? (await inTrashRefusal(tx, grant, id)) ?? refuse("not_found")
  );
}
