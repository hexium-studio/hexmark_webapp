import type { McpToolDefinition } from "./definition.ts";
import { TRASH_EXAMPLES } from "./examples-trash.ts";
import { WRITE_RESULT_FIELDS } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { HIDDEN, LOCKED } from "./note-tools.ts";
import { BATCH_HIDDEN, HIDDEN_CONTENT, PARENT_IN_TRASH } from "./trash-tools.ts";

// Restoring from the trash (trash-tools.ts): by id, as items in the trash
// have no address by title or path.

export const restoreNote = {
  name: "restore_note",
  title: "Restore note",
  permission: "delete",
  readOnly: false,
  description:
    "Bring a note back from the trash, by its id: into the folder it was deleted from, or " +
    "into folder_id when given, under its old title or title when given. The restore is a " +
    "new version with your reason. Fails with parent_in_trash when that folder is in the " +
    "trash too (restore the folder, or pass folder_id), and with title_taken when a note " +
    "there has its title now (pass another title or folder_id). Requires the delete " +
    "permission.",
  input: input.restore_note,
  defaults: {},
  result: WRITE_RESULT_FIELDS,
  errors: [
    HIDDEN,
    LOCKED,
    ["not_found", "No note this token can see has that id."],
    ["note_not_deleted", "The note is not in the trash."],
    PARENT_IN_TRASH,
    ["folder_not_found", "folder_id names no folder this token can see."],
    [
      "forbidden",
      "The target (or the root level) is outside this token's folders (reason: outside_scope).",
    ],
    [
      "title_taken",
      "The folder has a note with this title now (details: existingNoteId, path): restore " +
        "with another title (title) or into another folder (folder_id).",
    ],
  ],
  example: TRASH_EXAMPLES.restore_note,
} satisfies McpToolDefinition<typeof input.restore_note>;

export const restoreFolder = {
  name: "restore_folder",
  title: "Restore folder",
  permission: "delete",
  readOnly: false,
  description:
    "Bring a folder back from the trash, by its id, together with everything that was " +
    "deleted with it (its batch); items deleted on their own before stay in the trash. " +
    "Each note that comes back gets a new version with your reason. The answer counts " +
    "the subfolders (restoredSubfolders, not the folder itself) and notes that came back. " +
    "Fails with " +
    "parent_in_trash when its parent folder is in the trash (restore that one first) and " +
    "with name_taken when a folder there has its name now. Requires the delete permission.",
  input: input.restore_folder,
  defaults: {},
  result: [
    ["id", "string (uuid)", "The folder's id."],
    ["name", "string", "The folder's name."],
    ["path", "string", "Its path, in use again."],
    ["batchId", "string (uuid)", "The batch it was deleted with; everything in it is back."],
    [
      "restoredSubfolders",
      "integer",
      "Subfolders that came back with it; the folder itself is not counted.",
    ],
    [
      "restoredNotes",
      "integer",
      "Notes that came back with it, each as a new version with your reason.",
    ],
  ],
  errors: [
    BATCH_HIDDEN,
    HIDDEN_CONTENT,
    LOCKED,
    ["folder_not_found", "No folder this token can see has that id."],
    ["folder_not_deleted", "The folder is not in the trash."],
    PARENT_IN_TRASH,
    ["name_taken", "A folder in use has its name there now (details: existingFolderId, path)."],
  ],
  example: TRASH_EXAMPLES.restore_folder,
} satisfies McpToolDefinition<typeof input.restore_folder>;
