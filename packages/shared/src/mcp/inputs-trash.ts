import {
  idSchema,
  NOTE_TITLE_MAX_LENGTH,
  noteTitleSchema,
  REVISION_REASON_MAX_LENGTH,
  TRASH_LIST_LIMITS,
} from "../notes.ts";
import { boundedInt, expectedVersion, note, reason } from "./input-fields.ts";

// Inputs of the trash tools (see inputs.ts). Notes and folders in the trash
// are named by their id only: titles and paths address what is in use.

export const trashToolInputs = {
  delete_note: { note, expected_version: expectedVersion, reason },
  delete_folder: {
    folder_id: idSchema.describe(
      "The folder to move to the trash, with all its subfolders and notes (from " +
        "get_overview or list_folder).",
    ),
    reason: reason.describe(
      `Why you delete it, one short sentence (max ${REVISION_REASON_MAX_LENGTH} characters). ` +
        "Optional but expected: recorded with every note it takes along.",
    ),
  },
  list_trash: {
    folder_id: idSchema
      .optional()
      .describe(
        "List only what lay inside this folder (in use or in the trash) or below it; leave " +
          "out to list the whole trash this token can see.",
      ),
    limit: boundedInt(
      TRASH_LIST_LIMITS,
      `Maximum entries, newest first (default ${TRASH_LIST_LIMITS.default}).`,
    ),
  },
  restore_note: {
    note_id: idSchema.describe("Id of the note in the trash (from list_trash or delete_note)."),
    folder_id: idSchema
      .nullable()
      .optional()
      .describe(
        "Restore into this folder instead (null: the root level); leave out to restore it " +
          "where it was. Needed when its folder is in the trash and should stay there.",
      ),
    title: noteTitleSchema
      .optional()
      .describe(
        "Restore it under this title instead (unique within the folder, case is ignored, max " +
          `${NOTE_TITLE_MAX_LENGTH} characters); leave out to keep its title. Needed when a ` +
          "note there has its title now.",
      ),
    reason,
  },
  restore_folder: {
    folder_id: idSchema.describe(
      "Id of the folder in the trash (from list_trash or delete_folder): the folder it was " +
        "deleted with, not one inside it.",
    ),
    reason,
  },
} as const;
