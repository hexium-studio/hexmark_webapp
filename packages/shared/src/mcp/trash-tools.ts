import { TRASH_LIST_LIMITS, TRASH_RETENTION_DAYS } from "../notes.ts";
import type { McpToolDefinition, McpToolError } from "./definition.ts";
import { TRASH_EXAMPLES } from "./examples-trash.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH, HIDDEN, LOCKED, NOTE_ADDRESS_ERRORS } from "./note-tools.ts";

// The trash. Deleting moves a note, or a folder with everything in it, to
// the trash; it can be restored until the server purges it after the
// retention period (its days are in the server instructions and the guide).
// Agents can never delete anything for good: no tool does that.

const KEPT =
  "Restorable with restore_note / restore_folder until the server purges it after the " +
  `retention period (the server instructions name its days; default ${TRASH_RETENTION_DAYS.default}). ` +
  "Agents cannot delete anything for good.";

// A folder goes to the trash and comes back only as a whole batch, so an
// agent must be allowed to take along everything in it. One rule for both
// tools: a hidden item it can see is named (hidden); items out of its reach
// are not (forbidden, hidden_content); hidden comes first.
export const BATCH_HIDDEN: McpToolError = [
  "hidden",
  "The folder itself, or a note or folder inside it that would go along, is hidden from " +
    "agents (details: hiddenItem { kind, id, path } names it, hiddenAt, hiddenBy, reason; " +
    "locked: a lock refusing it as well, or null). This answer comes first, also when items " +
    "out of reach lie inside too. Nothing was changed; only a person can unhide it.",
];

export const HIDDEN_CONTENT: McpToolError = [
  "forbidden",
  "reason hidden_content: the folder holds notes or folders outside this token's reach " +
    "(not listed on an allow list, excluded on a deny list; they are not named), which " +
    "would go along. Nothing was changed. Ask a person.",
];

export const PARENT_IN_TRASH: McpToolError = [
  "parent_in_trash",
  "The folder it would come back into is in the trash itself (details: folderId, path): " +
    "restore that folder first, or (restore_note) pass folder_id.",
];

const TRASHED_FIELDS = [
  ["id", "string (uuid)", "Its id: pass it to restore_note or restore_folder."],
  ["path", "string", "Where it was: restoring brings it back there."],
  ["deletedAt", "string (ISO 8601)", "When it was moved to the trash."],
  ["purgeAt", "string (ISO 8601)", "When the server deletes it for good."],
  ["batchId", "string (uuid)", "What was deleted together shares this id."],
] as const;

export const deleteNote = {
  name: "delete_note",
  title: "Delete note",
  permission: "delete",
  readOnly: false,
  destructive: true,
  description:
    "Move a note to the trash: it disappears from reads, search and listings, its title is " +
    `free again, and the deletion is a new version with your reason. ${KEPT} Pass ` +
    "expected_version from your last read. Requires the delete permission.",
  input: input.delete_note,
  defaults: {},
  result: [
    ["kind", '"note"', "Always note."],
    ["version", "integer", "The version the deletion wrote (change: deleted)."],
    ...TRASHED_FIELDS,
  ],
  errors: [
    HIDDEN,
    LOCKED,
    ...NOTE_ADDRESS_ERRORS,
    [
      "version_conflict",
      "The note has a newer version than expected_version (details as for update_note). " +
        "Nothing was deleted.",
    ],
  ],
  example: TRASH_EXAMPLES.delete_note,
} satisfies McpToolDefinition<typeof input.delete_note>;

export const deleteFolder = {
  name: "delete_folder",
  title: "Delete folder",
  permission: "delete",
  readOnly: false,
  destructive: true,
  description:
    "Move a folder with all its subfolders and notes to the trash, as one batch: restoring " +
    "the folder brings all of it back. Every note taken along gets a new version with your " +
    `reason. ${KEPT} Requires the delete permission.`,
  input: input.delete_folder,
  defaults: {},
  result: [
    ["kind", '"folder"', "Always folder."],
    ...TRASHED_FIELDS,
    ["folderCount", "integer", "Subfolders moved along with it."],
    ["noteCount", "integer", "Notes moved along with it."],
  ],
  errors: [
    BATCH_HIDDEN,
    HIDDEN_CONTENT,
    LOCKED,
    ["folder_not_found", "No folder in use that this token can see has that id."],
    [
      FOLDER_IN_TRASH[0],
      "The folder is in the trash already (details: folderId, path, deletedAt, purgeAt, " +
        "batchId, batchRootId/batchRootPath when it went with a folder above it).",
    ],
  ],
  example: TRASH_EXAMPLES.delete_folder,
} satisfies McpToolDefinition<typeof input.delete_folder>;

export const listTrash = {
  name: "list_trash",
  title: "List trash",
  permission: "delete",
  readOnly: true,
  description:
    "List what is in the trash, newest first: notes and folders deleted on their own, and " +
    "for a folder deleted with its contents the folder alone, with how many subfolders " +
    "and notes went with it. Each entry has its id (for restore_note / restore_folder), " +
    "its path before deletion, who deleted it, when, and when it will be purged. Only " +
    "items that lay in this token's folders are listed. Requires the delete permission.",
  input: input.list_trash,
  defaults: { limit: TRASH_LIST_LIMITS.default },
  result: [
    ["retentionDays", "integer", "Days items stay in the trash before they are purged."],
    ["entries[]", "array", "Newest first."],
    ["entries[].kind", '"note" | "folder"', "What it is."],
    ["entries[].id", "string (uuid)", "Pass it to restore_note or restore_folder."],
    ["entries[].name", "string", "The note's title or the folder's name."],
    ["entries[].path", "string", "Its path before it was deleted."],
    [
      "entries[].parentId",
      "string | null",
      "Where it was (a note's folder, a folder's parent); null for the root level or a " +
        "parent outside this token's folders.",
    ],
    [
      "entries[].parentPath",
      "string | null",
      "That folder's path; '' for the root level, null for a parent outside this token's " +
        "folders.",
    ],
    ["entries[].deletedAt", "string (ISO 8601)", "When it was deleted."],
    ["entries[].deletedBy", "string", "Who deleted it: username or token name."],
    ["entries[].purgeAt", "string (ISO 8601)", "When the server deletes it for good."],
    ["entries[].batchId", "string (uuid)", "What was deleted together shares this id."],
    ["entries[].version", "integer (notes)", "The version the deletion wrote."],
    ["entries[].folderCount", "integer (folders)", "Subfolders deleted with it."],
    ["entries[].noteCount", "integer (folders)", "Notes deleted with it."],
    ["hasMore", "boolean", "More entries than limit."],
  ],
  errors: [["folder_not_found", "folder_id names no folder this token can see."]],
  example: TRASH_EXAMPLES.list_trash,
} satisfies McpToolDefinition<typeof input.list_trash>;
