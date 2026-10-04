import { clip, DETAIL_LIST_MAX, DETAIL_TEXT_MAX } from "./sanitize";

// The notes and folders an action on a folder took along (into the trash,
// back, or deleted for good), listed in the details of the folder's event
// with the id and the path each had then. Pure.
//
// The list is capped so the details stay below the size the table allows
// (sanitize.ts): sorted by path, then kind (folders first), then id, and
// cut where the next item would exceed the byte budget or the list limit.
// The same items always give the same list. A cut list says so
// (itemsTruncated) and how many there were (itemsTotal); the event's counts
// and the per-item events (batch-events.ts, removal-events.ts) still cover
// every item.

export interface AuditItem {
  kind: "note" | "folder";
  id: string;
  path: string;
}

export interface AuditItemList {
  items: AuditItem[];
  itemsTruncated?: true;
  itemsTotal?: number;
}

// UTF-8 bytes of the list as JSON; leaves room for the event's other
// details below DETAILS_JSON_MAX_BYTES.
export const ITEMS_JSON_MAX_BYTES = 8_000;

function compareItems(a: AuditItem, b: AuditItem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function auditItemList(
  items: readonly AuditItem[],
  maxBytes = ITEMS_JSON_MAX_BYTES,
  maxCount = DETAIL_LIST_MAX,
): AuditItemList {
  const sorted = items
    .map((item) => ({ kind: item.kind, id: item.id, path: clip(item.path, DETAIL_TEXT_MAX) }))
    .sort(compareItems);
  const kept: AuditItem[] = [];
  // "[" and "]", then each item with its comma.
  let bytes = 2;
  for (const item of sorted) {
    const size = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (kept.length >= maxCount || bytes + size > maxBytes) break;
    kept.push(item);
    bytes += size;
  }
  if (kept.length === sorted.length) return { items: kept };
  return { items: kept, itemsTruncated: true, itemsTotal: sorted.length };
}
