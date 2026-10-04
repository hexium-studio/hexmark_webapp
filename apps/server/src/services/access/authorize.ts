import type { NotePermission } from "@hexmark/shared";
import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Transaction } from "../../db/client";
import type { Failure } from "../../lib/outcome";
import { folderSubtreeIds } from "../notes/folder-index";
import { isFailure, refuse } from "../notes/refusals";
import { type Access, type AccessRef, lockAccess } from "./access";

// The one place that decides what a request may do with notes and folders:
// the permission (role, intersected with the token's permissions) and the
// token's folder scope (its folders and every folder below them). HTTP
// endpoints and MCP tools reach notes only through services that call
// authorize first, inside the transaction that then reads or writes.

export interface Grant {
  access: Access;
  // Folders the request may see; null means every folder and the root level.
  scope: ReadonlySet<string> | null;
}

export async function authorize(
  tx: Transaction,
  ref: AccessRef,
  now: Date,
  permission: NotePermission,
): Promise<Grant | Failure> {
  const access = await lockAccess(tx, ref, now);
  if (isFailure(access)) return access;
  if (!access.permissions.includes(permission)) return refuse("forbidden", { permission });
  const scope =
    access.folderScope === null ? null : new Set(await folderSubtreeIds(tx, access.folderScope));
  return { access, scope };
}

// Whether notes in this folder (null: the root level) are visible. A token
// limited to folders sees nothing at the root level.
export function canSeeFolder(grant: Grant, folderId: string | null): boolean {
  if (grant.scope === null) return true;
  return folderId !== null && grant.scope.has(folderId);
}

// For writes into a folder the caller named (create, move): refused with a
// reason rather than hidden, so an agent learns why.
export function requireFolder(grant: Grant, folderId: string | null): Failure | null {
  return canSeeFolder(grant, folderId) ? null : refuse("forbidden", { reason: "outside_scope" });
}

// SQL condition limiting a query to visible folders, for listings and search.
export function visibleFolderSql(grant: Grant, column: PgColumn | SQL): SQL {
  if (grant.scope === null) return sql`true`;
  return sql`${column} = any(${sql.param([...grant.scope])}::uuid[])`;
}
