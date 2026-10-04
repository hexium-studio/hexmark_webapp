import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NOTES_BODY_LIMIT_BYTES } from "../../../config/notes";
import { getChanges } from "./changes";
import { postFolder } from "./folders/create";
import { deleteFolderEndpoint } from "./folders/delete";
import { postMoveFolder } from "./folders/move";
import { patchFolder } from "./folders/rename";
import { postRestoreFolder } from "./folders/restore";
import { postNote } from "./notes/create";
import { deleteNote } from "./notes/delete";
import { postMoveNote } from "./notes/move";
import { getNote } from "./notes/read";
import { putSection } from "./notes/replace-section";
import { postRestoreNote } from "./notes/restore";
import { getRevision, getRevisions } from "./notes/revisions";
import { patchNote } from "./notes/update";
import { getOpenApi } from "./openapi";
import { getSearch } from "./search";
import { deleteTrashedFolder } from "./trash/delete-folder";
import { deleteTrashedNote } from "./trash/delete-note";
import { deleteTrash } from "./trash/empty";
import { getTrash } from "./trash/list";
import { getTree } from "./tree";

// Notes and folders, version 1. Mounted at /api/notes/v1 (src/api/index.ts).
// Input schemas and answer shapes: packages/shared/src/notes-api.ts and
// notes-responses.ts; the OpenAPI document: GET /openapi.json (public).
// The MCP tools (src/mcp) call the same services with the same checks.
//
// Every other endpoint: header `Authorization: Session <token>` (web app) or
// `Authorization: Bearer hmk_...` (API token). Changes are recorded with the
// username or the token's name. Permissions: read (tree, notes, revisions,
// changes), search, create, edit (title, body, sections, folder names), move,
// delete (the trash: deleting, listing, restoring); a token holds the intersection of
// its own and its owner's role; a token limited to folders sees only those
// and their subfolders (other notes are not found; writing into another
// folder is 403 forbidden { reason: "outside_scope" }).
//
// GET  /tree?folder&depth          { folder, folders, notes }; depth 1-10 (1); each
//                                    folder: { id, name, path, folderCount, noteCount,
//                                    loaded, folders?, notes? }, loaded false (no lists)
//                                    where the depth ends; notes: { id, title, version,
//                                    updatedAt, updatedBy, lastChange }
// GET  /notes/:id?view=full        { note: { ...header, body, metadata, characters,
//                                    approxTokens } }
//      ?view=outline               { note, budget, sections: [{ position, level, heading,
//                                    path, parentPosition, characters, approxTokens,
//                                    overBudget }] }
//      ?view=section&section=<path>&subsections=true|false&offset&limit
//                                  { note, section: { path, level, heading,
//                                    includesSubsections, text, characters, approxTokens,
//                                    offset, returned, total, hasMore, nextOffset, notice? } }
//      section: full path, or its end when that names one section; offset/limit in
//      characters read a piece, cut after a line break (services/notes/section-chunks.ts);
//      an offset at or past the end: empty text and a notice saying so (past the end
//      also requestedOffset, the offset as asked for; offset is then total)
//      a note in the trash named by its id: 409 in_trash { deletedAt, purgeAt, batchId,
//      path, batchRootId?, batchRootPath? } (path: where it was; batchRoot*: the folder
//      it was deleted with, if any)
//      404 section_not_found { section, paths }; 409 ambiguous_section { section,
//      candidates } (section: the path as requested)
// POST /notes  { folderId?, title, body, metadata?, reason? }  201 write result
// PATCH /notes/:id  { expectedVersion, title?, body?, reason? }
// PUT  /notes/:id/sections  { expectedVersion, heading (section path), body,
//      includeSubsections? (true), reason? }  body replaces the section from its
//      heading line on (with its subsections unless includeSubsections is false);
//      when a heading follows, a blank line before it is added if body lacks one
// POST /notes/:id/move  { expectedVersion, folderId (null: root), reason? }
// DELETE /notes/:id  { expectedVersion, reason? }  to the trash: { kind: "note", id,
//      version, path, deletedAt, purgeAt, batchId }
// POST /notes/:id/restore  { folderId?, title?, reason? } (body optional)  back into its
//      folder, or into folderId (null: root level), under its title or `title`; write
//      result; 409 note_not_deleted | title_taken | parent_in_trash { folderId, path }
//      (its folder is in the trash)
// GET  /notes/:id/revisions        { noteId, path, revisions: [{ version, change,
//                                    reason, actorName, createdAt, title, folderId,
//                                    folderPath, folderOutsideScope, sectionPath }] }
//      a folder outside the token's folders: folderId and folderPath null,
//      folderOutsideScope true
// GET  /notes/:id/revisions/:version  { revision: { noteId, ...summary, body,
//                                    metadata } }
// GET  /search?q&folder&limit      { hits: [{ noteId, title, folderId, folderPath,
//                                    sectionPath, heading (as written, no marks),
//                                    snippet («marked», without the heading line),
//                                    version, rank (0-1, relative to the best hit) }] }
// GET  /changes?since&limit        { changes: [{ noteId, title, folderPath, version,
//                                    change, changes, actorName, reason, sectionPath,
//                                    changedAt, deleted }] }
// POST /folders  { parentId?, name, reason? }  201 { id, name, parentId,
//      parentOutsideScope, path }; a parent outside the token's folders: parentId null,
//      flag true; the reason is recorded in the audit log
// PATCH /folders/:id  { name, reason? } (permission edit); POST /folders/:id/move
//      { parentId, reason? } (permission move); both answer like POST /folders (folders
//      keep no history: the reason is recorded in the audit log); 409 name_taken
//      { existingFolderId, path } names the folder holding the name there; moving into
//      itself or a subfolder: 409 folder_cycle { folderId, path, parentId, parentPath };
// A folder in use named by its id (tree, search, a target folder, renaming, moving,
//      deleting) that is in the trash: 409 folder_in_trash { folderId, path, deletedAt,
//      purgeAt, batchId, batchRootId?, batchRootPath? (the folder the batch was deleted
//      with, when it is another one) } within the caller's folders, 404 folder_not_found
//      outside them;
// DELETE /folders/:id  { reason? } (body optional)  the folder with its subfolders and
//      notes to the trash as one batch: { kind: "folder", id, path, deletedAt, purgeAt,
//      batchId, folderCount, noteCount }
// POST /folders/:id/restore  { reason? } (body optional)  the folder and its batch back:
//      { id, name, path, batchId, restoredSubfolders, restoredNotes } (subfolders - not
//      the folder itself - and notes that came back with it; each note with a new
//      version); 409 folder_not_deleted |
//      parent_in_trash | name_taken { existingFolderId, path }
//
// The trash (permission delete): items stay TRASH_RETENTION_DAYS (default 28) days,
// then the server purges them.
// GET  /trash?folder&limit         { retentionDays, entries: [{ kind, id, name, path,
//                                    parentId, parentPath (where it was: a note's folder,
//                                    a folder's parent; null/null outside the caller's
//                                    folders, null/"" the root level), deletedAt,
//                                    deletedBy, purgeAt, batchId,
//                                    version? (notes), folderCount?, noteCount? (folders)
//                                    }], hasMore }; folder: only what lay in it
// DELETE /trash/notes/:id, DELETE /trash/folders/:id  delete for good: { notes, folders }
//      (removed counts); signed-in people only: an API token gets 403 forbidden
//      { reason: "session_required" }; the password re-entered within the last 10
//      minutes (POST /api/auth/v1/reauthenticate), else 403 reauthentication_required;
//      409 note_not_deleted | folder_not_deleted
// DELETE /trash  empty the trash: administrators only (403 forbidden
//      { reason: "admin_required" }), with the password re-entered as above
//
// Note writes answer { id, version, changed, updatedAt, folderPath, path,
// warnings, message? }: changed is false when nothing would change (no new
// version, and a message saying so);
// warnings list sections whose own text exceeds SECTION_TOKEN_BUDGET
// ({ code: "section_over_budget", path, approxTokens, budget, message }) as a
// hint to split them. A replace_section records the section's path in the
// revision (sectionPath).
//
// Errors: 400 validation { fields } (a missing field is "required", a blank
// one "empty"); 401 unauthenticated | token_revoked |
// token_expired; 403 forbidden | setup_token_present; 404 not_found |
// folder_not_found | section_not_found; 409 version_conflict { currentVersion,
// updatedAt, updatedBy, lastChange: { change, reason, sectionPath },
// currentSection? } | title_taken { existingNoteId, path } | name_taken { existingFolderId, path } |
// ambiguous_section | folder_not_empty | folder_cycle | note_not_deleted |
// folder_not_deleted | in_trash | folder_in_trash | parent_in_trash;
// 413 payload_too_large; 503 database_unavailable | server_not_configured.

export const notesV1 = new Hono();

notesV1.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

notesV1.use(
  "*",
  bodyLimit({
    maxSize: NOTES_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

notesV1.get("/openapi.json", getOpenApi);
notesV1.get("/tree", getTree);
notesV1.get("/search", getSearch);
notesV1.get("/changes", getChanges);
notesV1.post("/notes", postNote);
notesV1.get("/notes/:id", getNote);
notesV1.patch("/notes/:id", patchNote);
notesV1.delete("/notes/:id", deleteNote);
notesV1.put("/notes/:id/sections", putSection);
notesV1.post("/notes/:id/move", postMoveNote);
notesV1.post("/notes/:id/restore", postRestoreNote);
notesV1.get("/notes/:id/revisions", getRevisions);
notesV1.get("/notes/:id/revisions/:version", getRevision);
notesV1.post("/folders", postFolder);
notesV1.patch("/folders/:id", patchFolder);
notesV1.post("/folders/:id/move", postMoveFolder);
notesV1.delete("/folders/:id", deleteFolderEndpoint);
notesV1.post("/folders/:id/restore", postRestoreFolder);
notesV1.get("/trash", getTrash);
notesV1.delete("/trash", deleteTrash);
notesV1.delete("/trash/notes/:id", deleteTrashedNote);
notesV1.delete("/trash/folders/:id", deleteTrashedFolder);
