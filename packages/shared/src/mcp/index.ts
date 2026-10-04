import { createFolder, moveFolder, renameFolder } from "./folder-tools.ts";
import { hideFolder, hideNote } from "./hide-tools.ts";
import { listRevisions, readRevision } from "./history-tools.ts";
import { lockFolder, lockNote } from "./lock-tools.ts";
import { readNote, readOutline, readSection } from "./note-tools.ts";
import { getOverview, listChanges, listFolder, searchNotes } from "./read-tools.ts";
import { restoreFolder, restoreNote } from "./restore-tools.ts";
import { deleteFolder, deleteNote, listTrash } from "./trash-tools.ts";
import { createNote, moveNote, replaceSection, updateNote } from "./write-tools.ts";

// The MCP tools: one definition each, registered by the server
// (apps/server/src/mcp) and documented in docs/mcp.md by
// tools/generate-mcp-docs.mjs. Imported as "@hexmark/shared/mcp".

export * from "./definition.ts";
export * from "./inputs.ts";
export { ALREADY_LOCKED_MESSAGE } from "./lock-tools.ts";

// By name, in the order docs/mcp.md lists them: orient, find and read,
// history, write notes, folders, trash, locks, hiding.
export const MCP_TOOLS = {
  get_overview: getOverview,
  list_folder: listFolder,
  search_notes: searchNotes,
  read_outline: readOutline,
  read_section: readSection,
  read_note: readNote,
  list_changes: listChanges,
  list_revisions: listRevisions,
  read_revision: readRevision,
  create_note: createNote,
  update_note: updateNote,
  replace_section: replaceSection,
  move_note: moveNote,
  create_folder: createFolder,
  rename_folder: renameFolder,
  move_folder: moveFolder,
  delete_note: deleteNote,
  delete_folder: deleteFolder,
  list_trash: listTrash,
  restore_note: restoreNote,
  restore_folder: restoreFolder,
  lock_note: lockNote,
  lock_folder: lockFolder,
  hide_note: hideNote,
  hide_folder: hideFolder,
} as const;
