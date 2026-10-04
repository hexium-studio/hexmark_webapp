import {
  createFolderInputSchema,
  deleteFolderInputSchema,
  deleteNoteInputSchema,
  moveFolderInputSchema,
  renameFolderInputSchema,
  restoreFolderInputSchema,
  restoreNoteInputSchema,
  trashQuerySchema,
} from "@hexmark/shared";
import type { RouteDoc } from "../../../lib/openapi";
import {
  both,
  FOLDER_IN_TRASH,
  FOLDER_RESULT,
  noteWrite,
  TITLE_TAKEN,
  WRITE_RESULT,
  write,
} from "./openapi-common";

// Folders and the trash in the OpenAPI document (openapi.ts).

const PARENT_IN_TRASH = "parent_in_trash (folderId, path)";
const FOR_GOOD = {
  "200": "{ notes, folders } (removed)",
  ...write,
  "403":
    "forbidden (permission; reason session_required: API tokens cannot delete for good) | " +
    "reauthentication_required (password not re-entered in the last 10 minutes) | " +
    "setup_token_present",
};

export const FOLDER_ROUTES: RouteDoc[] = [
  {
    method: "post",
    path: "/folders",
    summary: "Create a folder",
    security: both,
    body: createFolderInputSchema,
    responses: {
      "201": FOLDER_RESULT,
      ...write,
      "409": `name_taken (existingFolderId, path) | ${FOLDER_IN_TRASH}`,
    },
  },
  {
    method: "patch",
    path: "/folders/{id}",
    summary: "Rename a folder (permission edit)",
    security: both,
    body: renameFolderInputSchema,
    responses: {
      "200": FOLDER_RESULT,
      ...write,
      "409": `name_taken (existingFolderId, path) | ${FOLDER_IN_TRASH}`,
    },
  },
  {
    method: "post",
    path: "/folders/{id}/move",
    summary: "Move a folder (permission move)",
    security: both,
    body: moveFolderInputSchema,
    responses: {
      "200": FOLDER_RESULT,
      ...write,
      "409":
        "name_taken (existingFolderId, path) | folder_cycle (folderId, path, parentId, " +
        `parentPath) | ${FOLDER_IN_TRASH}`,
    },
  },
];

export const TRASH_ROUTES: RouteDoc[] = [
  {
    method: "delete",
    path: "/notes/{id}",
    summary: "Move a note to the trash",
    security: both,
    body: deleteNoteInputSchema,
    responses: {
      ...noteWrite,
      "200": "{ kind: note, id, version, path, deletedAt, purgeAt, batchId }",
    },
  },
  {
    method: "post",
    path: "/notes/{id}/restore",
    summary: "Restore a note from the trash",
    security: both,
    body: restoreNoteInputSchema,
    bodyOptional: true,
    responses: {
      "200": WRITE_RESULT,
      ...write,
      "409": `note_not_deleted | ${TITLE_TAKEN} | ${PARENT_IN_TRASH}`,
    },
  },
  {
    method: "delete",
    path: "/folders/{id}",
    summary: "Move a folder with everything in it to the trash",
    security: both,
    body: deleteFolderInputSchema,
    bodyOptional: true,
    responses: {
      "200": "{ kind: folder, id, path, deletedAt, purgeAt, batchId, folderCount, noteCount }",
      ...write,
      "409": FOLDER_IN_TRASH,
    },
  },
  {
    method: "post",
    path: "/folders/{id}/restore",
    summary: "Restore a folder and what was deleted with it",
    security: both,
    body: restoreFolderInputSchema,
    bodyOptional: true,
    responses: {
      "200": "{ id, name, path, batchId, restoredSubfolders, restoredNotes }",
      ...write,
      "409": `folder_not_deleted | ${PARENT_IN_TRASH} | name_taken (existingFolderId, path)`,
    },
  },
  {
    method: "get",
    path: "/trash",
    summary: "What is in the trash",
    security: both,
    query: trashQuerySchema,
    responses: { "200": "{ retentionDays, entries, hasMore }", ...write },
  },
  {
    method: "delete",
    path: "/trash/notes/{id}",
    summary: "Delete a note in the trash for good (signed-in people only)",
    security: both,
    responses: { ...FOR_GOOD, "409": "note_not_deleted" },
  },
  {
    method: "delete",
    path: "/trash/folders/{id}",
    summary: "Delete a folder in the trash for good (signed-in people only)",
    security: both,
    responses: { ...FOR_GOOD, "409": "folder_not_deleted | folder_not_empty" },
  },
  {
    method: "delete",
    path: "/trash",
    summary: "Empty the trash (signed-in administrators only)",
    security: both,
    responses: { ...FOR_GOOD, "403": `${FOR_GOOD["403"]} | forbidden (reason admin_required)` },
  },
];
