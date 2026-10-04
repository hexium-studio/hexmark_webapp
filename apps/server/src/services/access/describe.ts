import type { NotePermission } from "@hexmark/shared";
import type { Outcome } from "../../lib/outcome";
import { loadFolderIndex } from "../notes/folder-index";
import { isFailure } from "../notes/refusals";
import { runNoteTransaction } from "../notes/transaction";
import { type AccessRef, lockAccess } from "./access";

// What a caller may do, in words an agent can use: its name in the history,
// its permissions and the folders it is limited to (with their paths).

export interface AccessDescription {
  actorName: string;
  permissions: NotePermission[];
  folderScope: { id: string; path: string }[] | null;
}

export function describeAccess(ref: AccessRef, now: Date): Promise<Outcome<AccessDescription>> {
  return runNoteTransaction(async (tx) => {
    const access = await lockAccess(tx, ref, now);
    if (isFailure(access)) return access;
    const index = access.folderScope ? await loadFolderIndex(tx) : null;
    return {
      actorName: access.actor.name,
      permissions: access.permissions,
      folderScope: access.folderScope?.map((id) => ({ id, path: index?.pathOf(id) ?? "" })) ?? null,
    };
  });
}
