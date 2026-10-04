import type { NoteErrorCode } from "@hexmark/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type Failure, fail } from "../../lib/outcome";

// The one table of how notes, tokens and access refuse: code -> HTTP status.
// The MCP tools send the same codes with a short English text (src/mcp).

const STATUS: Record<NoteErrorCode, ContentfulStatusCode> = {
  unauthenticated: 401,
  token_revoked: 401,
  token_expired: 401,
  setup_token_present: 403,
  forbidden: 403,
  not_found: 404,
  folder_not_found: 404,
  section_not_found: 404,
  ambiguous_note: 409,
  ambiguous_section: 409,
  version_conflict: 409,
  title_taken: 409,
  name_taken: 409,
  folder_not_empty: 409,
  folder_cycle: 409,
  note_not_deleted: 409,
  folder_not_deleted: 409,
  in_trash: 409,
  folder_in_trash: 409,
  parent_in_trash: 409,
  locked: 423,
  hidden: 403,
  payload_too_large: 413,
  database_unavailable: 503,
  server_not_configured: 503,
  internal: 500,
};

export function refuse(code: NoteErrorCode, details?: Record<string, unknown>): Failure {
  return fail(STATUS[code], code, details);
}

export function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && (value as Failure).ok === false;
}

// A 400 validation answer for one field, in the shape of lib/validation.ts,
// for rules that can only be checked on the stored note (e.g. the size of a
// body after replacing a section).
export function fieldRefusal(field: string, code: string, params?: Record<string, number>) {
  return fail(400, "validation", { fields: { [field]: params ? { code, params } : { code } } });
}
