import type { NameTakenDetails } from "@hexmark/shared";
import { and, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { folders } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { joinPath, loadFolderIndex } from "./folder-index";
import { refuse } from "./refusals";
import { constraintOf } from "./transaction";

// Folder names are unique per parent among folders in use (case ignored),
// decided by the unique indexes. Every write that gives a folder a name in
// a parent - creating, renaming, moving, restoring from the trash - runs
// through guardFolderName: when the index refuses, the transaction goes on
// and the answer is name_taken naming the folder that holds the name, the
// same way title_taken names the note holding a title.

const NAME_CLASH = new Set(["folders_parent_id_name_unique", "folders_root_name_unique"]);

export interface FolderPlace {
  parentId: string | null;
  name: string;
  // The folder being written, which is not its own rival.
  id?: string;
}

export async function guardFolderName<T>(
  tx: Transaction,
  place: FolderPlace,
  write: (savepoint: Transaction) => Promise<T>,
): Promise<T | Failure> {
  try {
    return await tx.transaction(write);
  } catch (error) {
    const constraint = constraintOf(error);
    if (!constraint || !NAME_CLASH.has(constraint)) throw error;
    const [holder] = await tx
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(
        and(
          isNull(folders.deletedAt),
          place.id ? ne(folders.id, place.id) : sql`true`,
          sql`${folders.parentId} is not distinct from ${place.parentId}::uuid`,
          sql`lower(${folders.name}) = lower(${place.name}::text)`,
        ),
      );
    if (!holder) return refuse("name_taken");
    const index = await loadFolderIndex(tx);
    const details: NameTakenDetails = {
      existingFolderId: holder.id,
      path: joinPath(index.pathOf(place.parentId), holder.name),
    };
    return refuse("name_taken", { ...details });
  }
}
