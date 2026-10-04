import type { RouteDoc } from "../../../lib/openapi";

// Answers several routes of the OpenAPI document share (openapi.ts).

export const both: RouteDoc["security"] = ["session", "bearer"];
export const write = {
  "400": "validation (fields: code per field; missing: required, blank: empty)",
  "401": "unauthenticated | token_revoked | token_expired",
  "403":
    "forbidden (details: permission, or reason outside_scope | hidden_content) | hidden " +
    "(hiddenItem: { kind, id, path }, hiddenAt, hiddenBy, reason, locked): API tokens only | " +
    "setup_token_present",
  "404": "not_found | folder_not_found",
  "423": "locked (lockedItem: { kind, id, path }, lockedAt, lockedBy, reason): API tokens only",
};
export const WRITE_RESULT =
  "{ id, version, changed, updatedAt, folderPath, path, warnings, message? }";
export const FOLDER_RESULT = "{ id, name, parentId, parentOutsideScope, path }";
export const TITLE_TAKEN = "title_taken (existingNoteId, path)";
export const IN_TRASH =
  "in_trash (deletedAt, purgeAt, batchId, path, batchRootId?, batchRootPath?)";
export const FOLDER_IN_TRASH =
  "folder_in_trash (folderId, path, deletedAt, purgeAt, batchId, batchRootId?, batchRootPath?)";
export const noteWrite = {
  "200": WRITE_RESULT,
  ...write,
  "409": `version_conflict (currentVersion, updatedAt, updatedBy, lastChange) | ${TITLE_TAKEN} | ${IN_TRASH}`,
};
