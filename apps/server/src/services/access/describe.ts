import type { NotePermission } from "@hexmark/shared";
import { inArray } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { notes } from "../../db/schema";
import type { Outcome } from "../../lib/outcome";
import { joinPath, loadFolderIndex } from "../notes/folder-index";
import { isFailure } from "../notes/refusals";
import { runNoteTransaction } from "../notes/transaction";
import { type AccessRef, lockAccess } from "./access";
import { type AccessPolicy, concealed } from "./policy";

// What a caller may do, in words an agent can use: its name in the history,
// its access mode, what it holds and, for an allow_list token, the listed
// targets with their paths. A deny_list token is not told what it cannot
// reach: excluded items stay invisible, also here. Neither are the listed
// targets below a hidden folder named: they do not exist for an agent.

export interface ListedTarget {
  kind: "folder" | "note";
  id: string;
  path: string;
  permissions: readonly NotePermission[];
  inTrash: boolean;
}

export interface AccessDescription {
  actorName: string;
  // "all" for a person's session.
  mode: AccessPolicy["mode"];
  permissions: readonly NotePermission[];
  // allow_list only; null otherwise.
  entries: ListedTarget[] | null;
}

export async function listedTargets(
  tx: Transaction,
  policy: AccessPolicy,
): Promise<ListedTarget[] | null> {
  if (policy.mode !== "allow_list") return null;
  const index = await loadFolderIndex(tx, true);
  const live = await loadFolderIndex(tx);
  const noteIds = [...policy.notes.keys()];
  const rows =
    noteIds.length === 0
      ? []
      : await tx
          .select({
            id: notes.id,
            title: notes.title,
            folderId: notes.folderId,
            deletedAt: notes.deletedAt,
          })
          .from(notes)
          .where(inArray(notes.id, noteIds));
  const granted = (list: readonly NotePermission[]) =>
    list.filter((permission) => policy.granted.includes(permission));
  const hiddenAbove = (chain: string[], from: 0 | 1) =>
    concealed(policy, chain, index.hidden, from);
  const folders = [...policy.folders]
    .filter(([id]) => !hiddenAbove(index.chain(id), 1))
    .map(([id, permissions]) => ({
      kind: "folder" as const,
      id,
      path: index.pathOf(id),
      permissions: granted(permissions),
      inTrash: live.get(id) === undefined,
    }));
  const listed = rows
    .filter((row) => !hiddenAbove(index.chain(row.folderId), 0))
    .map((row) => ({
      kind: "note" as const,
      id: row.id,
      path: joinPath(index.pathOf(row.folderId), row.title),
      permissions: granted(policy.notes.get(row.id) ?? []),
      inTrash: row.deletedAt !== null,
    }));
  return [...folders, ...listed].sort((a, b) => a.path.localeCompare(b.path));
}

export function describeAccess(ref: AccessRef, now: Date): Promise<Outcome<AccessDescription>> {
  return runNoteTransaction(async (tx) => {
    const access = await lockAccess(tx, ref, now);
    if (isFailure(access)) return access;
    return {
      actorName: access.actor.name,
      mode: access.policy.mode,
      permissions: access.permissions,
      entries: await listedTargets(tx, access.policy),
    };
  });
}
