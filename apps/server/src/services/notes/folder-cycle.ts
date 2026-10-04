import type { FolderCycleDetails } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import type { Failure } from "../../lib/outcome";
import { folderSubtreeIds, loadFolderIndex } from "./folder-index";
import { refuse } from "./refusals";

// A folder cannot move into itself or one of its subfolders. The refusal
// names both folders - the one to move and the target inside it - with
// their paths. Checked by moveFolder (folders.ts) under the folder tree's
// lock, on the subtree as it is in that transaction.
export async function folderCycleRefusal(
  tx: Transaction,
  id: string,
  parentId: string | null,
): Promise<Failure | null> {
  if (parentId === null || !(await folderSubtreeIds(tx, [id])).includes(parentId)) return null;
  const index = await loadFolderIndex(tx);
  const details: FolderCycleDetails = {
    folderId: id,
    path: index.pathOf(id),
    parentId,
    parentPath: index.pathOf(parentId),
  };
  return refuse("folder_cycle", { ...details });
}
