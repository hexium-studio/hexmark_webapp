import { CHANGES_LIMITS, SEARCH_LIMITS, TREE_DEPTH_LIMITS } from "../notes.ts";
import type { McpToolDefinition } from "./definition.ts";
import { READ_EXAMPLES } from "./examples-read.ts";
import { treeFields } from "./fields.ts";
import { mcpToolInputs as input } from "./inputs.ts";
import { FOLDER_IN_TRASH } from "./note-tools.ts";

// Tools for finding one's way: overview, folder listing, search, changes.

export const getOverview = {
  name: "get_overview",
  title: "Overview",
  permission: "read",
  readOnly: true,
  description:
    "Start here. Returns who this token acts as (the name shown in the history), its " +
    "permissions and the folders it is limited to, the top two levels of the folder tree " +
    "with note ids, titles and versions, and how many notes and folders it can see. Go " +
    "deeper with list_folder. Requires the read permission.",
  input: input.get_overview,
  defaults: {},
  result: [
    ["instance.name", "string", "Name of the wiki software."],
    ["access.kind", '"token"', "Always token over MCP."],
    ["access.actorName", "string", "The token's name: shown in the history for its changes."],
    ["access.permissions", "string[]", "What this token may do (see Permissions)."],
    [
      "access.folderScope",
      "array | null",
      "Folders (id, path) the token is limited to, with their subfolders; null: whole wiki.",
    ],
    ...treeFields("tree"),
    ["treeDepth", "integer", "Folder levels the tree shows (2)."],
    ["counts.notes", "integer", "Notes this token can see."],
    ["counts.folders", "integer", "Folders this token can see."],
  ],
  errors: [],
  example: READ_EXAMPLES.get_overview,
} satisfies McpToolDefinition<typeof input.get_overview>;

export const listFolder = {
  name: "list_folder",
  title: "List folder",
  permission: "read",
  readOnly: true,
  description:
    "List a folder's subfolders and notes (id, title, version, last change), or the root " +
    "level when folder_id is left out. Raise depth to open subfolders as well; a subfolder " +
    "where the depth ends has loaded: false and only its folderCount and noteCount. Lists " +
    "titles only; read a note with read_outline, read_section or read_note. Requires the " +
    "read permission.",
  input: input.list_folder,
  defaults: { depth: TREE_DEPTH_LIMITS.default },
  result: treeFields(""),
  errors: [
    ["folder_not_found", "No such folder, or it lies outside this token's folders."],
    FOLDER_IN_TRASH,
  ],
  example: READ_EXAMPLES.list_folder,
} satisfies McpToolDefinition<typeof input.list_folder>;

export const searchNotes = {
  name: "search_notes",
  title: "Search notes",
  permission: "search",
  readOnly: true,
  description:
    "Full-text search over all notes this token can see, ranked per section. Each hit " +
    "names the note (noteId, title, folder path), the sectionPath to pass to read_section, " +
    "its heading as written, a snippet of its text with matches marked «like this» (… where " +
    "it is cut off), the note's current version and a relative rank. Search first, then " +
    "read only the sections you need. Requires the search permission.",
  input: input.search_notes,
  defaults: { limit: SEARCH_LIMITS.default },
  result: [
    ["hits[]", "array", "Best matches first; one hit per matching section."],
    ["hits[].noteId", "string (uuid)", "The note's id."],
    ["hits[].title", "string", "The note's title."],
    ["hits[].folderId", "string | null", "The note's folder; null for the root level."],
    ["hits[].folderPath", "string", "Folder names from the root joined by '/'."],
    ["hits[].sectionPath", "string", "The matching section: pass it to read_section."],
    [
      "hits[].heading",
      "string",
      "The section's heading as written, without marks; '' for the introduction.",
    ],
    [
      "hits[].snippet",
      "string",
      "The section's text around the matches, without its heading line; matches marked " +
        "«like this» (a phrase as one mark), '…' where text is left out.",
    ],
    ["hits[].version", "integer", "The note's current version."],
    [
      "hits[].rank",
      "number",
      "Relevance relative to the best hit of this search: 1 for the best, 0 to 1 for the " +
        "others (three decimals).",
    ],
  ],
  errors: [["folder_not_found", "folder_id names no folder this token can see."], FOLDER_IN_TRASH],
  example: READ_EXAMPLES.search_notes,
} satisfies McpToolDefinition<typeof input.search_notes>;

export const listChanges = {
  name: "list_changes",
  title: "List changes",
  permission: "read",
  readOnly: true,
  description:
    "List the notes changed after a time, newest first, one entry per note: its latest " +
    "change (created, edited, renamed, moved, deleted, restored), how many changes there " +
    "were, who made the latest one and why, and the section it edited. Use it to catch up " +
    "since your last visit (folders have no versions and are not listed); see " +
    "every version with list_revisions. Requires the read permission.",
  input: input.list_changes,
  defaults: { limit: CHANGES_LIMITS.default },
  result: [
    ["changes[]", "array", "One entry per changed note, latest change first."],
    ["changes[].noteId", "string (uuid)", "The note's id."],
    ["changes[].title", "string", "The note's current title."],
    ["changes[].folderPath", "string", "The note's current folder path."],
    ["changes[].version", "integer", "The note's current version."],
    [
      "changes[].change",
      "string",
      "Latest change: created, edited, renamed, moved, deleted or restored.",
    ],
    ["changes[].changes", "integer", "How many versions were written since `since`."],
    ["changes[].actorName", "string", "Who made the latest change: username or token name."],
    ["changes[].reason", "string | null", "The reason given with the latest change."],
    [
      "changes[].sectionPath",
      "string | null",
      "The section the latest change edited (replace_section); null for whole-note changes.",
    ],
    ["changes[].changedAt", "string (ISO 8601)", "When the latest change was made."],
    ["changes[].deleted", "boolean", "true when the note is in the trash now."],
  ],
  errors: [],
  example: READ_EXAMPLES.list_changes,
} satisfies McpToolDefinition<typeof input.list_changes>;
