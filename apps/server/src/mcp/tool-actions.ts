import type { AuditAction } from "@hexmark/shared";
import type { MCP_TOOLS } from "@hexmark/shared/mcp";

// The audit action of each MCP tool: what its call is logged as (reads only
// for agents, which every MCP caller is). The services write the events;
// this names the action for arguments refused before a service runs.
export const TOOL_ACTIONS: Record<keyof typeof MCP_TOOLS, AuditAction> = {
  get_overview: "read.overview",
  list_folder: "read.folder",
  search_notes: "read.search",
  read_outline: "read.outline",
  read_section: "read.section",
  read_note: "read.note",
  list_changes: "read.changes",
  list_revisions: "read.revisions",
  read_revision: "read.revision",
  create_note: "note.created",
  update_note: "note.updated",
  replace_section: "note.section_replaced",
  move_note: "note.moved",
  create_folder: "folder.created",
  rename_folder: "folder.renamed",
  move_folder: "folder.moved",
  delete_note: "note.deleted",
  delete_folder: "folder.deleted",
  list_trash: "read.trash",
  restore_note: "note.restored",
  restore_folder: "folder.restored",
  lock_note: "note.locked",
  lock_folder: "folder.locked",
  hide_note: "note.hidden",
  hide_folder: "folder.hidden",
};
