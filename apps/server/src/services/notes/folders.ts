import type { FolderResult, NotePermission } from "@hexmark/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { type Folder, folders } from "../../db/schema";
import type { Failure, Outcome } from "../../lib/outcome";
import type { AccessRef } from "../access/access";
import { authorize, chainRefusal, folderRefusal, type Grant } from "../access/authorize";
import { recordAccessEvent } from "../audit/access-events";
import { runAudited } from "../audit/audited";
import type { AuditTarget } from "../audit/record";
import { folderChainRefusal } from "../locks/lock-guard";
import { missingFolder } from "../trash/in-trash";
import { isUuid } from "./addressing";
import { folderCycleRefusal } from "./folder-cycle";
import { joinPath, loadFolderIndex } from "./folder-index";
import { guardFolderName } from "./folder-name";
import { lockTargetFolder } from "./note-create";
import { updatedBy } from "./note-store";
import { isFailure, refuse } from "./refusals";
import { showParent } from "./scoped-folder";

// Creating, renaming and moving folders (into the trash and back:
// services/trash). Folders have no version and keep no history: each
// change locks the folder's row, so concurrent changes run one after the
// other and the last one wins, and the audit log records it with its
// reason. Folder ids never change.

// Built from the parent's path, so it also describes a folder just deleted.
// The parent of a top folder of a token limited to folders lies outside them
// and is not named (scoped-folder.ts).
async function result(tx: Transaction, grant: Grant, row: Folder): Promise<FolderResult> {
  const index = await loadFolderIndex(tx);
  const path = joinPath(index.pathOf(row.parentId), row.name);
  return { id: row.id, name: row.name, ...showParent(grant, row.parentId), path };
}

export function createFolder(
  ref: AccessRef,
  now: Date,
  input: { parentId: string | null; name: string; reason?: string },
): Promise<Outcome<FolderResult>> {
  return runAudited({ ref, action: "folder.created", input }, async (tx) => {
    const grant = await authorize(tx, ref, now, "create", true);
    if (isFailure(grant)) return grant;
    const refused = await lockTargetFolder(tx, grant, input.parentId, "create");
    if (refused) return refused;
    const { actor } = grant.access;
    const inserted = await guardFolderName(tx, grant.view, input, (savepoint) =>
      savepoint
        .insert(folders)
        .values({
          parentId: input.parentId,
          name: input.name,
          createdAt: now,
          createdByUserId: actor.userId,
          createdByTokenId: actor.tokenId,
          createdByName: actor.name,
          ...updatedBy(grant.access.actor, now),
        })
        .returning(),
    );
    if (isFailure(inserted)) return inserted;
    const [row] = inserted;
    if (!row) throw new Error("the folder was not inserted");
    const created = await result(tx, grant, row);
    await recordAccessEvent(
      tx,
      grant.access,
      {
        action: "folder.created",
        target: folderTarget(created),
        reason: input.reason ?? null,
        details: { parentId: row.parentId },
      },
      now,
    );
    return created;
  });
}

function folderTarget(folder: { id: string; path: string }): AuditTarget {
  return { kind: "folder", id: folder.id, label: folder.path };
}

interface FolderChange {
  action: "folder.renamed" | "folder.moved";
  permission: NotePermission;
  input: { reason?: string };
  apply: (tx: Transaction, grant: Grant, row: Folder) => Promise<Folder | Failure>;
}

// One folder change: authorize, lock the folder, check it is in use, that
// the caller holds the permission on it and (an agent) that it is not
// locked, apply, and log it with the path before and after.
function changeFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  change: FolderChange,
): Promise<Outcome<FolderResult>> {
  const { action, permission, input } = change;
  return runAudited({ ref, action, input: { id, ...input } }, async (tx) => {
    const grant = await authorize(tx, ref, now, permission);
    if (isFailure(grant)) return grant;
    if (!isUuid(id)) return refuse("folder_not_found");
    if (permission === "move") await serializeFolderTree(tx);
    const [row] = await tx
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
      .for("update");
    if (!row) return missingFolder(tx, grant, id);
    const refused =
      folderRefusal(grant.view, row.id, permission) ??
      (await folderChainRefusal(tx, grant, row.id, grant.view, (chain, hidden) =>
        chainRefusal(grant.access.policy, { kind: "folder" }, chain, hidden, permission),
      ));
    if (refused) return refused;
    const previousPath = (await loadFolderIndex(tx)).pathOf(row.id);
    const changed = await change.apply(tx, grant, row);
    if (isFailure(changed)) return changed;
    const after = await result(tx, grant, changed);
    const details = {
      changed: changed !== row,
      ...(previousPath !== after.path ? { previousPath } : {}),
      ...(row.name !== changed.name ? { previousName: row.name, name: changed.name } : {}),
      ...(row.parentId !== changed.parentId
        ? { previousParentId: row.parentId, parentId: changed.parentId }
        : {}),
    };
    const reason = changed !== row ? (input.reason ?? null) : null;
    await recordAccessEvent(
      tx,
      grant.access,
      { action, target: folderTarget(after), reason, details },
      now,
    );
    return after;
  });
}

async function save(
  tx: Transaction,
  grant: Grant,
  row: Folder,
  values: Partial<Folder>,
): Promise<Folder | Failure> {
  const place = {
    id: row.id,
    parentId: values.parentId ?? row.parentId,
    name: values.name ?? row.name,
  };
  const saved = await guardFolderName(tx, grant.view, place, (savepoint) =>
    savepoint.update(folders).set(values).where(eq(folders.id, row.id)).returning(),
  );
  if (isFailure(saved)) return saved;
  const [updated] = saved;
  if (!updated) throw new Error("the folder was not updated");
  return updated;
}

export function renameFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: { name: string; reason?: string },
) {
  return changeFolder(ref, now, id, {
    action: "folder.renamed",
    permission: "edit",
    input,
    apply: async (tx, grant, row) =>
      row.name === input.name
        ? row
        : save(tx, grant, row, { name: input.name, ...updatedBy(grant.access.actor, now) }),
  });
}

// Changes of the tree's shape - moving a folder, moving one to the trash
// and back - are serialised (one transaction-level advisory lock, taken
// before any folder row): two moves cannot each pass the cycle check and
// together form a cycle, and a folder cannot move into or out of a subtree
// while that subtree goes to the trash.
export async function serializeFolderTree(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hexmark.folder_moves'))`);
}

export function moveFolder(
  ref: AccessRef,
  now: Date,
  id: string,
  input: { parentId: string | null; reason?: string },
) {
  const { parentId } = input;
  return changeFolder(ref, now, id, {
    action: "folder.moved",
    permission: "move",
    input,
    apply: async (tx, grant, row) => {
      if (row.parentId === parentId) return row;
      // The target first: a cycle names the target's path, which a caller
      // who cannot see the target (below a hidden folder) must not learn.
      const refused = await lockTargetFolder(tx, grant, parentId, "move");
      if (refused) return refused;
      const cycle = await folderCycleRefusal(tx, id, parentId);
      if (cycle) return cycle;
      return save(tx, grant, row, { parentId, ...updatedBy(grant.access.actor, now) });
    },
  });
}
