// The cursor of the audit log's pages (query.ts): the last event's time, in
// microseconds and UTC as PostgreSQL stores it, and its id, as base64url.
// Opaque to clients. Pure.

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

const CURSOR_TEXT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f-]{36})$/;

export function decodeCursor(cursor: string): { at: string; id: string } | null {
  const match = CURSOR_TEXT.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? { at: match[1] as string, id: match[2] as string } : null;
}
