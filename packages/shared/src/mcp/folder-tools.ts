import type { McpResultField, McpToolDefinition, McpToolError } from "./definition.ts";
import { WRITE_EXAMPLES } from "./examples-write.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH } from "./note-tools.ts";

// Tools that create and change folders. Folders have no versions and keep no
// history: a change takes no expected_version, its reason is recorded in the
// audit log, and concurrent changes of one folder run one after the other.
// Folder ids never change.
// The permissions are those of the HTTP endpoints: create, edit (rename),
// move.

function folderResult(parentOutsideScope: string): McpResultField[] {
  return [
    ["id", "string (uuid)", "The folder's id; never changes."],
    ["name", "string", "The folder's name."],
    ["parentId", "string | null", "The parent folder; null for the root level (or outside)."],
    ["parentOutsideScope", "boolean", parentOutsideScope],
    ["path", "string", "Folder names from the root joined by '/'."],
  ];
}

const OUTSIDE =
  "true when the parent lies outside this token's folders (a folder it is limited to): " +
  "then parentId is null.";

const FOLDER_IN_USE: readonly McpToolError[] = [
  ["folder_not_found", "No folder in use that this token can see has that id."],
  FOLDER_IN_TRASH,
];

const NAME_TAKEN: McpToolError = [
  "name_taken",
  "The parent already has a folder with this name, case ignored (details: existingFolderId, " +
    "path): choose another name, or rename that folder first.",
];

const OUTSIDE_SCOPE: McpToolError = [
  "forbidden",
  "The parent (or the root level) is outside this token's folders (reason: outside_scope).",
];

export const createFolder = {
  name: "create_folder",
  title: "Create folder",
  permission: "create",
  readOnly: false,
  description:
    "Create a folder inside a parent folder, or at the root level when parent_id is left " +
    "out. Returns its id and path. Folders have no versions; the reason is recorded in the " +
    "audit log. Requires the create permission.",
  input: input.create_folder,
  defaults: {},
  result: folderResult("Always false here: the parent must be in your folders."),
  errors: [
    ["folder_not_found", "The parent folder does not exist."],
    [
      FOLDER_IN_TRASH[0],
      "The parent folder is in the trash (details: folderId, path, deletedAt, purgeAt, " +
        "batchId, batchRootId/batchRootPath when it went with a folder above it).",
    ],
    OUTSIDE_SCOPE,
    NAME_TAKEN,
  ],
  example: WRITE_EXAMPLES.create_folder,
} satisfies McpToolDefinition<typeof input.create_folder>;

export const renameFolder = {
  name: "rename_folder",
  title: "Rename folder",
  permission: "edit",
  readOnly: false,
  description:
    "Give a folder a new name; its id, its contents and the notes' ids stay the same, the " +
    "paths below it change. Folders keep no history, so there is no expected_version; " +
    "the reason is recorded in the audit log. Returns the folder with its new path. " +
    "Requires the edit permission.",
  input: input.rename_folder,
  defaults: {},
  result: folderResult(OUTSIDE),
  errors: [...FOLDER_IN_USE, NAME_TAKEN],
  example: WRITE_EXAMPLES.rename_folder,
} satisfies McpToolDefinition<typeof input.rename_folder>;

export const moveFolder = {
  name: "move_folder",
  title: "Move folder",
  permission: "move",
  readOnly: false,
  description:
    "Move a folder with everything in it into another parent folder (parent_id null: the " +
    "root level). Ids stay the same, the paths below it change. A folder cannot move into " +
    "itself or one of its subfolders. Folders keep no history, so there is no " +
    "expected_version; the reason is recorded in the audit log. Returns the folder with " +
    "its new path. Requires the move permission.",
  input: input.move_folder,
  defaults: {},
  result: folderResult(OUTSIDE),
  errors: [
    ["folder_not_found", "folder_id or parent_id names no folder in use this token can see."],
    [
      FOLDER_IN_TRASH[0],
      "The folder or the target parent is in the trash (details: folderId, path, deletedAt, " +
        "purgeAt, batchId, batchRootId/batchRootPath when it went with a folder above it).",
    ],
    OUTSIDE_SCOPE,
    NAME_TAKEN,
    [
      "folder_cycle",
      "parent_id is the folder itself or one of its subfolders (details: folderId, path of " +
        "the folder; parentId, parentPath of the target).",
    ],
  ],
  example: WRITE_EXAMPLES.move_folder,
} satisfies McpToolDefinition<typeof input.move_folder>;
