import type { McpResultField } from "./definition.ts";

// Result fields several tools share, for the tool definitions.

export function noteHeaderFields(prefix: string): McpResultField[] {
  const at = (field: string) => `${prefix}.${field}`;
  return [
    [at("id"), "string (uuid)", "The note's id; never changes, even on rename or move."],
    [at("title"), "string", "The note's title."],
    [at("folderId"), "string | null", "Folder the note is in; null for the root level."],
    [at("folderPath"), "string", "Folder names from the root joined by '/'; '' at the root."],
    [
      at("path"),
      "string",
      "folderPath + '/' + title (the title alone at the root): usable as its address.",
    ],
    [at("version"), "integer", "Current version: pass it as expected_version when writing."],
    [at("createdAt"), "string (ISO 8601)", "When the note was created."],
    [at("createdBy"), "string", "Who created it: a username or an API token's name."],
    [at("updatedAt"), "string (ISO 8601)", "When the latest version was written."],
    [at("updatedBy"), "string", "Who wrote the latest version: a username or a token name."],
  ];
}

export function treeFields(prefix: string): McpResultField[] {
  const at = (field: string) => (prefix ? `${prefix}.${field}` : field);
  return [
    [at("folder"), "object | null", "The folder listed (id, name, path); null for the root level."],
    [at("folders[]"), "array", "Subfolders, sorted by name."],
    [at("folders[].id"), "string (uuid)", "The folder's id."],
    [at("folders[].name"), "string", "The folder's name."],
    [at("folders[].path"), "string", "Folder names from the root joined by '/'."],
    [at("folders[].folderCount"), "integer", "Subfolders directly inside it."],
    [at("folders[].noteCount"), "integer", "Notes directly inside it."],
    [
      at("folders[].loaded"),
      "boolean",
      "false where the requested depth ends: then folders and notes are left out (not " +
        "empty); list the folder itself to open it.",
    ],
    [at("folders[].folders"), "array (loaded only)", "Its subfolders, same shape."],
    [at("folders[].notes"), "array (loaded only)", "Its notes, same shape as notes[]."],
    [at("notes[]"), "array", "Notes directly in the folder, sorted by title."],
    [at("notes[].id"), "string (uuid)", "The note's id."],
    [at("notes[].title"), "string", "The note's title."],
    [at("notes[].version"), "integer", "The note's current version."],
    [at("notes[].updatedAt"), "string (ISO 8601)", "When the latest version was written."],
    [at("notes[].updatedBy"), "string", "Who wrote it: a username or a token name."],
    [
      at("notes[].lastChange"),
      "string",
      "What the latest version changed: created, edited, renamed, moved or restored.",
    ],
  ];
}

export const WRITE_RESULT_FIELDS: readonly McpResultField[] = [
  ["id", "string (uuid)", "The note's id."],
  ["version", "integer", "The note's version now: the expected_version of your next write."],
  [
    "changed",
    "boolean",
    "false when the write changed nothing; then no version was written and the reason " +
      "was dropped.",
  ],
  ["updatedAt", "string (ISO 8601)", "When the version was written."],
  ["folderPath", "string", "The note's folder path now; '' at the root level."],
  ["path", "string", "The note's path now (folderPath + '/' + title): usable as its address."],
  [
    "warnings[]",
    "array",
    "section_over_budget for each section whose own text is above the reading budget " +
      "(code, path, approxTokens, budget, message): split it with more headings or read it " +
      "in chunks. Nothing is refused.",
  ],
  ["message", "string (only if changed is false)", "Says that nothing was written, and why."],
];
