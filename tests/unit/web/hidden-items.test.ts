import { describe, expect, it } from "vitest";
import { readHiddenItem } from "@/lib/locks/load";

// The hidden items of /locked as read from GET /api/notes/v1/hidden: every
// field checked, a malformed item refused (the page then says the server
// gave an unexpected answer rather than showing half an item).

describe("a hidden item as read", () => {
  const item = {
    kind: "folder",
    id: "f",
    path: "Vault",
    hiddenAt: "2026-10-04T10:00:00.000Z",
    hiddenBy: "ada",
    reason: null,
    coveredFolders: 1,
    coveredNotes: 3,
  };

  it("keeps a well-formed item", () => {
    expect(readHiddenItem(item)).toEqual(item);
    expect(readHiddenItem({ ...item, kind: "note", reason: "Private" })).toMatchObject({
      kind: "note",
      reason: "Private",
    });
  });

  it("refuses a malformed one", () => {
    expect(readHiddenItem({ ...item, kind: "page" })).toBeUndefined();
    expect(readHiddenItem({ ...item, hiddenBy: 7 })).toBeUndefined();
    expect(readHiddenItem({ ...item, reason: 1 })).toBeUndefined();
    expect(readHiddenItem({ ...item, coveredNotes: "3" })).toBeUndefined();
    expect(readHiddenItem(null)).toBeUndefined();
  });
});
