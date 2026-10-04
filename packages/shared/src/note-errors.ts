// `error` values of /api/notes/v1, /api/tokens/v1 and the MCP tools, besides
// "validation" (400 with field codes, field-errors.ts). Codes, never
// sentences: the web app translates them, MCP adds a short English text.

export const NOTE_ERROR_CODES = [
  // 401: no session or token, or one that is not (or no longer) valid.
  "unauthenticated",
  "token_revoked",
  "token_expired",
  // 403: SETUP_TOKEN is still set; nobody can sign in, no token works.
  "setup_token_present",
  // 403: the permission is missing (details: permission), the target folder
  // lies outside what the token can reach (details: reason "outside_scope";
  // also the root level for an allow_list token), a folder to delete holds
  // something the token cannot reach (reason "hidden_content"), or
  // the action is for signed-in people only (reason "session_required":
  // deleting from the trash for good) or administrators ("admin_required":
  // emptying the trash).
  "forbidden",
  // 404: no such note, folder, section, revision or token visible to the caller.
  "not_found",
  "folder_not_found",
  "section_not_found",
  // 409: a name matches several notes or sections (details: candidates).
  "ambiguous_note",
  "ambiguous_section",
  // 409: the note changed since the version the write is based on.
  "version_conflict",
  // 409: a note with this title (or a folder with this name) exists there.
  "title_taken",
  "name_taken",
  // 409: a folder deleted for good still holds folders or notes that are
  // not in the trash (a guard; trashing a folder takes its contents along).
  "folder_not_empty",
  // 409: a folder cannot move into itself or one of its subfolders.
  "folder_cycle",
  // 409: only a note (folder) in the trash can be restored.
  "note_not_deleted",
  "folder_not_deleted",
  // 409: the note named by its id is in the trash (details: deletedAt,
  // purgeAt); restore it first.
  "in_trash",
  // 409: the folder named by its id is in the trash (details: deletedAt,
  // purgeAt, batchId); restore it (or the folder it was deleted with) first.
  "folder_in_trash",
  // 409: the folder a note or folder would be restored into is in the trash
  // (details: folderId, path); restore that folder first or choose another.
  "parent_in_trash",
  // 423: an agent tried to change, move, rename, delete, restore or create
  // inside a locked note or folder (details: LockedDetails, locks.ts). Only
  // people can unlock; they may change locked items.
  "locked",
  // 403: the note's content (body, outline, sections, revisions) cannot be
  // read by agents, or an agent tried to change, move, rename, delete,
  // restore, lock or create inside a hidden note or folder (details:
  // HiddenDetails, hidden.ts; for a write also `locked` when a lock refuses
  // it as well). Only people unhide; they read and change hidden items.
  "hidden",
  "payload_too_large",
  "database_unavailable",
  "server_not_configured",
  "internal",
] as const;

export type NoteErrorCode = (typeof NOTE_ERROR_CODES)[number];
