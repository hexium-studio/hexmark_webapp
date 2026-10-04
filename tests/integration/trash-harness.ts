import type { TestDatabase } from "../support/databases";
import {
  type Auth,
  createFolder,
  createNote,
  type NotesWorld,
  notesApi,
} from "./notes-api-harness";

// Helpers for the tests of the trash: a small tree to delete from, and the
// rows as the database holds them, so tests compare tables, not answers.

export interface TrashTree {
  projects: string;
  web: string;
  old: string;
  spec: string;
  draft: string;
  plan: string;
}

// <prefix> (projects) > Web > Old; notes Web/Spec, Web/Old/Draft and Plan
// directly in <prefix>.
export async function trashTree(world: NotesWorld, auth: Auth, prefix: string) {
  const projects = await createFolder(world, auth, prefix);
  const web = await createFolder(world, auth, "Web", projects);
  const old = await createFolder(world, auth, "Old", web);
  const spec = await createNote(world, auth, { folderId: web, title: "Spec", body: "# Spec\n" });
  const draft = await createNote(world, auth, { folderId: old, title: "Draft", body: "draft" });
  const plan = await createNote(world, auth, { folderId: projects, title: "Plan", body: "plan" });
  return { projects, web, old, spec, draft, plan } satisfies TrashTree;
}

export interface TrashRow {
  id: string;
  version?: number;
  inTrash: boolean;
  deletedByName: string | null;
  deletedByUserId: string | null;
  deletedByTokenId: string | null;
  batchId: string | null;
}

// The trash columns of these rows, in the order of `ids`.
export async function trashRows(
  db: TestDatabase,
  table: "notes" | "folders",
  ids: readonly string[],
): Promise<TrashRow[]> {
  const version = table === "notes" ? db.sql`, version` : db.sql``;
  const rows = await db.sql`
    select id, deleted_at is not null as in_trash, deleted_by_name, deleted_by_user_id,
      deleted_by_token_id, trash_batch_id ${version}
    from ${db.sql(table)} where id in ${db.sql(ids)}`;
  const byId = new Map(rows.map((row) => [row.id as string, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`no row ${id} in ${table}`);
    return {
      id,
      ...(table === "notes" ? { version: row.version as number } : {}),
      inTrash: row.in_trash as boolean,
      deletedByName: row.deleted_by_name as string | null,
      deletedByUserId: row.deleted_by_user_id as string | null,
      deletedByTokenId: row.deleted_by_token_id as string | null,
      batchId: row.trash_batch_id as string | null,
    };
  });
}

export interface TableCounts {
  notes: number;
  folders: number;
  revisions: number;
  sections: number;
  notes_in_trash: number;
  folders_in_trash: number;
}

// How many rows each table holds, to show what a deletion removed and kept.
export async function tableCounts(db: TestDatabase): Promise<TableCounts> {
  const [row] = await db.sql`
    select (select count(*)::int from notes) as notes,
      (select count(*)::int from folders) as folders,
      (select count(*)::int from note_revisions) as revisions,
      (select count(*)::int from note_sections) as sections,
      (select count(*)::int from notes where deleted_at is not null) as notes_in_trash,
      (select count(*)::int from folders where deleted_at is not null) as folders_in_trash`;
  return row as unknown as TableCounts;
}

export const trashApi = `${notesApi}/trash`;
