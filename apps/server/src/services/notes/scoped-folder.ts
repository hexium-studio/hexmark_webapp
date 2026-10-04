import { canSeeFolder, type Grant } from "../access/authorize";
import type { FolderIndex } from "./folder-index";

// Folders named in an answer that the caller did not choose: the folder a
// revision was in, the parent of a folder. A token limited to folders learns
// neither the id nor the path of a folder outside them; the answer says only
// that it lies outside. Whether it does is canSeeFolder's decision.

export interface ShownFolder {
  folderId: string | null;
  // Current path ('' for the root level); null when the folder no longer
  // exists or lies outside the caller's folders.
  folderPath: string | null;
  folderOutsideScope: boolean;
}

export function showFolder(grant: Grant, index: FolderIndex, folderId: string | null): ShownFolder {
  if (!canSeeFolder(grant, folderId)) {
    return { folderId: null, folderPath: null, folderOutsideScope: true };
  }
  const gone = folderId !== null && index.get(folderId) === undefined;
  return { folderId, folderPath: gone ? null : index.pathOf(folderId), folderOutsideScope: false };
}

// A folder's parent: hidden like a revision's folder when outside.
export function showParent(
  grant: Grant,
  parentId: string | null,
): { parentId: string | null; parentOutsideScope: boolean } {
  return canSeeFolder(grant, parentId)
    ? { parentId, parentOutsideScope: false }
    : { parentId: null, parentOutsideScope: true };
}
