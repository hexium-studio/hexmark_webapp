import { describe, expect, it } from "vitest";
import {
  type AuditItem,
  auditItemList,
  ITEMS_JSON_MAX_BYTES,
} from "../../../apps/server/src/services/audit/item-list";
import {
  DETAILS_JSON_MAX_BYTES,
  sanitizeDetails,
} from "../../../apps/server/src/services/audit/sanitize";

// The items a folder action took along, as listed in its audit event
// (item-list.ts): sorted, capped by bytes and count, the same for the same
// items, and saying when it was cut.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

describe("auditItemList", () => {
  it("lists every item, by path, folders before notes at the same path, then id", () => {
    const items: AuditItem[] = [
      { kind: "note", id: id(3), path: "Box/b" },
      { kind: "note", id: id(2), path: "Box/a" },
      { kind: "folder", id: id(4), path: "Box/a" },
      { kind: "note", id: id(1), path: "Box/a" },
    ];
    expect(auditItemList(items)).toEqual({
      items: [
        { kind: "folder", id: id(4), path: "Box/a" },
        { kind: "note", id: id(1), path: "Box/a" },
        { kind: "note", id: id(2), path: "Box/a" },
        { kind: "note", id: id(3), path: "Box/b" },
      ],
    });
  });

  it("cuts at the list limit and says so, with the total", () => {
    const items = Array.from({ length: 80 }, (_, n) => ({
      kind: "note" as const,
      id: id(n),
      path: `F/n${String(n).padStart(3, "0")}`,
    }));
    const list = auditItemList(items);
    expect(list.items).toHaveLength(50);
    expect(list).toMatchObject({ itemsTruncated: true, itemsTotal: 80 });
    expect(list.items[0]?.path).toBe("F/n000");
    expect(list.items.at(-1)?.path).toBe("F/n049");
  });

  it("cuts by size with long paths and stays below the details limit", () => {
    const long = "ü".repeat(290);
    const items = Array.from({ length: 50 }, (_, n) => ({
      kind: "folder" as const,
      id: id(n),
      path: `${long}${String(n).padStart(2, "0")}`,
    }));
    const list = auditItemList(items);
    expect(list.itemsTruncated).toBe(true);
    expect(list.itemsTotal).toBe(50);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.length).toBeLessThan(50);
    expect(bytes(list.items)).toBeLessThanOrEqual(ITEMS_JSON_MAX_BYTES);
    // Through the sanitizer with the other details of a folder event: whole.
    const details = { batchId: id(99), folderCount: 50, noteCount: 0, ...list };
    const clean = sanitizeDetails(details);
    expect(clean).not.toHaveProperty("omitted");
    expect(clean.items).toEqual(list.items);
    expect(bytes(clean)).toBeLessThanOrEqual(DETAILS_JSON_MAX_BYTES);
  });

  it("gives the same list for the same items in any order", () => {
    const items = Array.from({ length: 120 }, (_, n) => ({
      kind: (n % 3 === 0 ? "folder" : "note") as AuditItem["kind"],
      id: id(n),
      path: `P/${n % 7}/${n}`,
    }));
    const reversed = [...items].reverse();
    expect(auditItemList(reversed)).toEqual(auditItemList(items));
  });

  it("lists nothing for no items, without a cut", () => {
    expect(auditItemList([])).toEqual({ items: [] });
  });
});
