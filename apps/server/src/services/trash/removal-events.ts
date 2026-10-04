import type { AuditSource } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import { uuidv7 } from "../../lib/uuid";
import type { AuditActor } from "../audit/actor";
import { type AuditItem, auditItemList } from "../audit/item-list";
import { type AuditEventInput, recordEvents } from "../audit/record";
import { type FolderIndex, joinPath, loadFolderIndex } from "../notes/folder-index";
import { recordEntryRemovals } from "./entry-removal-events";
import type { Removed } from "./trash-remove";

// Deleting from the trash for good writes one audit event per note and per
// folder removed - by a person (deleted_permanently) or by the purge
// (purged) - in the transaction that removes them. The events of one
// removal share a runId; each names the trash batch the item was in. Paths
// are taken from the folder index loaded before the rows went. A folder
// removed with what was below it (the topmost such folder of the run: the
// folder deleted for good, or a purged folder batch) lists those items in
// its details (item-list.ts, capped) with their counts; each of those
// items names it as viaFolder. API token entries removed with an item are
// logged as well (entry-removal-events.ts).

export interface RemovalLog {
  actor: AuditActor;
  source: AuditSource;
  kind: "deleted_permanently" | "purged";
  // Why the items went: a note, a folder, emptying the trash, or the purge.
  via: "note" | "folder" | "empty_trash" | "retention";
}

// Load before removing: afterwards the folders are gone.
export function indexBeforeRemoval(tx: Transaction): Promise<FolderIndex> {
  return loadFolderIndex(tx, true);
}

// The topmost folder removed in this run that holds an item whose folder
// (or parent) is `parentId`: null when that folder was not removed with it.
function removalRoot(
  index: FolderIndex,
  removedFolders: ReadonlySet<string>,
  parentId: string | null,
): string | null {
  let root: string | null = null;
  let steps = 0;
  for (let id = parentId; id !== null && removedFolders.has(id); steps++) {
    if (steps > index.size) break;
    root = id;
    id = index.get(id)?.parentId ?? null;
  }
  return root;
}

export async function recordRemovals(
  tx: Transaction,
  index: FolderIndex,
  removed: Removed,
  log: RemovalLog,
  now: Date,
): Promise<string> {
  const runId = uuidv7();
  const removedFolders = new Set(removed.folders.map((item) => item.id));
  const items = [
    ...removed.notes.map((item) => ({
      kind: "note" as const,
      id: item.id,
      path: joinPath(index.pathOf(item.parent_id), item.name),
      batchId: item.trash_batch_id,
      root: removalRoot(index, removedFolders, item.parent_id),
      entries: item.entries ?? [],
    })),
    ...removed.folders.map((item) => ({
      kind: "folder" as const,
      id: item.id,
      path: index.pathOf(item.id),
      batchId: item.trash_batch_id,
      root: removalRoot(index, removedFolders, item.parent_id),
      entries: item.entries ?? [],
    })),
  ];
  const byRoot = new Map<string, AuditItem[]>();
  for (const item of items) {
    if (item.root === null) continue;
    const members = byRoot.get(item.root);
    if (members) members.push(item);
    else byRoot.set(item.root, [item]);
  }
  const events = items.map((item): AuditEventInput => {
    const members =
      item.root === null && item.kind === "folder" ? (byRoot.get(item.id) ?? []) : null;
    return {
      actor: log.actor,
      source: log.source,
      action: `${item.kind}.${log.kind}`,
      target: { kind: item.kind, id: item.id, label: item.path },
      details: {
        runId,
        via: log.via,
        batchId: item.batchId,
        ...(item.root !== null
          ? { viaFolder: { id: item.root, path: index.pathOf(item.root) } }
          : {}),
        ...(members ? memberDetails(members) : {}),
      },
    };
  });
  await recordEvents(tx, events, now);
  await recordEntryRemovals(tx, items, { runId, via: log.via }, now);
  return runId;
}

function memberDetails(members: readonly AuditItem[]) {
  return {
    folderCount: members.filter((item) => item.kind === "folder").length,
    noteCount: members.filter((item) => item.kind === "note").length,
    ...auditItemList(members),
  };
}
