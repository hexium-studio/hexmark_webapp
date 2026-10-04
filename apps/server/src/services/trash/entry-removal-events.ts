import type { Transaction } from "../../db/client";
import { SYSTEM_ACTOR } from "../audit/actor";
import { type AuditEventInput, recordEvents } from "../audit/record";
import type { RemovedEntry } from "./trash-remove";

// A note or folder deleted for good takes the API token entries pointing at
// it along (the database cascades). The server reports each such entry as
// token.entry_removed by "System" - whoever deleted the item - in the same
// transaction, naming the token, the entry and its target as it was.

export interface RemovedTarget {
  kind: "note" | "folder";
  id: string;
  path: string;
  entries: readonly RemovedEntry[];
}

export async function recordEntryRemovals(
  tx: Transaction,
  targets: readonly RemovedTarget[],
  context: { runId: string; via: string },
  now: Date,
): Promise<void> {
  const events = targets.flatMap((target) =>
    target.entries.map(
      (entry): AuditEventInput => ({
        actor: SYSTEM_ACTOR,
        source: "system",
        action: "token.entry_removed",
        target: { kind: "token", id: entry.tokenId, label: entry.tokenName },
        details: {
          runId: context.runId,
          via: context.via,
          entryId: entry.id,
          mode: entry.mode,
          permissions: entry.permissions,
          targetKind: target.kind,
          targetId: target.id,
          targetPath: target.path,
          cause: "target_deleted_permanently",
        },
      }),
    ),
  );
  await recordEvents(tx, events, now);
}
