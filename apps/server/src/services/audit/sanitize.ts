// What may go into an audit event's details, and how big they may get.
// Pure, so it can be tested on its own.
//
// Details hold facts about an action - ids, titles and paths, section
// paths, versions, sizes, permission lists, old and new names - never
// passwords, tokens, TOTP secrets or codes, recovery codes, the setup token
// or note bodies. Two layers:
// - summarizeInput keeps only known, harmless fields of what a client sent
//   (an allow-list): used for failures, where the input is all there is.
// - sanitizeDetails is the net under every event: it drops any field whose
//   name looks secret, shortens long texts and lists, and keeps the whole
//   object below the size the table allows, dropping the largest fields
//   first (deterministically) and naming them in `omitted`.

// Longest text kept per value; search queries are kept shorter.
export const DETAIL_TEXT_MAX = 300;
export const QUERY_TEXT_MAX = 200;
// Most items kept per list, and how deep objects are followed.
export const DETAIL_LIST_MAX = 50;
const DETAIL_DEPTH_MAX = 4;
// UTF-8 bytes of the details as JSON text. The table allows 16 KB as stored
// (pg_column_size); staying well below leaves room for jsonb's overhead.
export const DETAILS_JSON_MAX_BYTES = 12_000;

const ELLIPSIS = "…";

// Field names that are never logged. Names ending in Id, Ids, Count,
// Characters or Prefix are counts and references, and stay.
const SECRET_NAME =
  /password|secret|otp|recovery_?codes?$|^codes?$|^token$|tokens$|hash|setup_?token|authorization|cookie|challenge|public_?key|e_?mail|^body$|^text$|^response$|^metadata$/i;
const REFERENCE_NAME = /(Id|Ids|Count|Characters|Prefix)$/;

export function isSecretField(name: string): boolean {
  return SECRET_NAME.test(name) && !REFERENCE_NAME.test(name);
}

// Shortens to `max` characters (code points, so no emoji is cut in half).
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max - 1).join("")}${ELLIPSIS}`;
}

function clean(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return clip(value, DETAIL_TEXT_MAX);
  if (value instanceof Date) return value.toISOString();
  if (depth >= DETAIL_DEPTH_MAX) return undefined;
  if (Array.isArray(value)) {
    const items = value.slice(0, DETAIL_LIST_MAX).map((item) => clean(item, depth + 1));
    return value.length > DETAIL_LIST_MAX
      ? [...items, `+${value.length - DETAIL_LIST_MAX}`]
      : items;
  }
  if (typeof value === "object") return cleanObject(value as Record<string, unknown>, depth + 1);
  return undefined;
}

function cleanObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (isSecretField(key)) continue;
    const value = clean(input[key], depth);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = cleanObject(details ?? {}, 0);
  if (jsonBytes(out) <= DETAILS_JSON_MAX_BYTES) return out;
  // Largest field first; equal sizes by name. Deterministic for equal input.
  const bySize = Object.keys(out)
    .map((key) => ({ key, size: jsonBytes(out[key]) }))
    .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
  const omitted: string[] = [];
  for (const { key } of bySize) {
    delete out[key];
    omitted.push(key);
    if (jsonBytes({ ...out, omitted }) <= DETAILS_JSON_MAX_BYTES) break;
  }
  return { ...out, omitted: omitted.sort() };
}

// Input fields a failure may show, by the names the HTTP API (camelCase)
// and the MCP tools (snake_case) use.
const INPUT_FIELDS = new Set([
  "note",
  "noteId",
  "note_id",
  "id",
  "folder",
  "folderId",
  "folder_id",
  "parentId",
  "parent_id",
  "expectedVersion",
  "expected_version",
  "section",
  "heading",
  "includeSubsections",
  "include_subsections",
  "subsections",
  "view",
  "offset",
  "limit",
  "depth",
  "since",
  "version",
  "title",
  "name",
  "permissions",
  "folderScope",
  "expiresAt",
  "requireTwoFactor",
  "timezone",
]);

const QUERY_FIELDS = new Set(["query", "q"]);

// A short, harmless summary of what a client sent: known fields only; a
// note body as its length; the search query shortened.
export function summarizeInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (key === "body" && typeof value === "string") {
      out.bodyCharacters = Array.from(value).length;
    } else if (QUERY_FIELDS.has(key) && typeof value === "string") {
      out.query = clip(value, QUERY_TEXT_MAX);
    } else if (key === "note" && typeof value === "object" && value !== null) {
      // A note reference of the services: { id } or { address }.
      const ref = value as { id?: unknown; address?: unknown };
      out.note = typeof ref.id === "string" ? ref.id : ref.address;
    } else if (INPUT_FIELDS.has(key)) {
      out[key] = value;
    }
  }
  return sanitizeDetails(out);
}

// What a refusal said besides its code, without anything that could hold
// content (a conflict's current section text, a field's rule text).
const REFUSAL_FIELDS = new Set([
  "permission",
  "permissions",
  "reason",
  "currentVersion",
  "existingNoteId",
  "existingFolderId",
  "path",
  "folderId",
  "batchId",
  "batchRootId",
  "batchRootPath",
  "parentId",
  "parentPath",
  "section",
  "folderIds",
]);

export function summarizeRefusal(details: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (REFUSAL_FIELDS.has(key)) out[key] = value;
  }
  const clean = sanitizeDetails(out);
  // Field names with their error codes only (no rule texts, no values), as
  // a list of { field, error }: a field may be called "body", and "code" is a
  // name the filter drops (TOTP codes).
  const fields = details?.fields;
  if (typeof fields === "object" && fields !== null) {
    clean.fields = Object.entries(fields as Record<string, { code?: unknown }>)
      .map(([field, error]) => ({ field: clip(field, 64), error: error?.code }))
      .filter((entry) => typeof entry.error === "string" && /^[a-z_]{1,40}$/.test(entry.error))
      .sort((a, b) => a.field.localeCompare(b.field));
  }
  return clean;
}
