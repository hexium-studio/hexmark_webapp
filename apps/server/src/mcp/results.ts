import type { FieldErrors } from "@hexmark/shared";
import type { McpErrorCode } from "@hexmark/shared/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Outcome } from "../lib/outcome";
import { invalidInputResult } from "./input-rules";

// Tool answers: the value as JSON text, or a tool error with the same code as
// the HTTP API plus a short English explanation for the agent. Field
// problems ("validation" in the HTTP API) are invalid_input here, with a rule
// per field like invalid arguments. A tool may word a code's text for its
// own case (`messages`), e.g. title_taken when restoring, where another
// title or folder is the way on.

export type ToolMessages = Partial<Record<McpErrorCode, string>>;

const MESSAGES: Record<Exclude<McpErrorCode, "invalid_input">, string> = {
  unauthenticated: "The API token is not valid.",
  token_revoked: "The API token was revoked; ask the user for a new one.",
  token_expired: "The API token has expired; ask the user for a new one.",
  setup_token_present: "The server is not ready: its setup token is still set.",
  forbidden: "This token is not allowed to do that (see permission or reason).",
  not_found: "No such note (or revision) visible to this token.",
  folder_not_found: "No such folder visible to this token.",
  section_not_found: "The note has no such section; paths lists the ones it has.",
  ambiguous_note: "Several notes match; repeat with the id or path of one of the candidates.",
  ambiguous_section: "Several sections match; repeat with one of the candidate paths.",
  version_conflict:
    "The note changed since your version (lastChange says how). Read it again, merge your " +
    "change and retry with currentVersion as expected_version.",
  title_taken:
    "A note with this title already exists in that folder (existingNoteId); choose another " +
    "title or change that note.",
  name_taken:
    "A folder with this name already exists there (existingFolderId, path); choose another " +
    "name, or rename or move that folder first.",
  folder_not_empty: "The folder still holds folders or notes in use.",
  folder_cycle:
    "A folder cannot move into itself or one of its subfolders (folderId, path: the folder; " +
    "parentId, parentPath: the target inside it). Choose a parent outside it.",
  note_not_deleted: "The note is not in the trash.",
  folder_not_deleted: "The folder is not in the trash.",
  folder_in_trash:
    "The folder is in the trash (folderId, path: which and where it was; deletedAt; purgeAt: " +
    "when it is deleted for good; batchId: what was deleted with it; batchRootId, " +
    "batchRootPath: the folder above it the batch was deleted with, if any). Restore it " +
    "with restore_folder - batchRootId when given, else folderId - to use it again.",
  in_trash:
    "The note is in the trash (deletedAt; purgeAt: when it is deleted for good; batchId: " +
    "what was deleted with it; path: where it was; batchRootId, batchRootPath: the folder " +
    "it was deleted with, if any). Restore it with restore_note (or that folder with " +
    "restore_folder) to read or change it.",
  parent_in_trash:
    "The folder it would come back into is in the trash too (folderId, path). Restore that " +
    "folder first with restore_folder, or pass folder_id to restore_note to put it elsewhere.",
  payload_too_large: "The request is too large.",
  database_unavailable: "The database is not available; try again later.",
  server_not_configured: "The server is not fully configured.",
  internal: "Internal error.",
};

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(
  error: string,
  details?: Record<string, unknown>,
  messages: ToolMessages = {},
): CallToolResult {
  if (error === "validation") {
    return invalidInputResult((details?.fields ?? {}) as FieldErrors);
  }
  const code = error as keyof typeof MESSAGES;
  const message = messages[code] ?? MESSAGES[code] ?? "The request was refused.";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error, message, ...details }, null, 2) }],
  };
}

export function toolResult<T>(
  outcome: Outcome<T>,
  shape?: (value: T) => unknown,
  messages?: ToolMessages,
): CallToolResult {
  if (!outcome.ok) return errorResult(outcome.error, outcome.details, messages);
  return jsonResult(shape ? shape(outcome.value) : outcome.value);
}
