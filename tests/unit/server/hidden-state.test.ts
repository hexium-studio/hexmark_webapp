import { describe, expect, it } from "vitest";
import { AccessView } from "../../../apps/server/src/services/access/access-view";
import type { AccessPolicy } from "../../../apps/server/src/services/access/policy";
import {
  folderHiddenState,
  hiddenRefusal,
  noteHiddenState,
} from "../../../apps/server/src/services/hidden/hidden-state";
import { lockedRefusal } from "../../../apps/server/src/services/locks/lock-guard";
import { FolderIndex } from "../../../apps/server/src/services/notes/folder-index";

// The hidden mark an item is under (hidden-state.ts): its own, else the
// nearest hidden folder above it - also for what is created there later -
// and the refusal hidden, alone (reads), with no lock (null) or with the
// lock a write meets as well (hidden wins over locked).

const at = new Date("2026-10-04T10:00:00.000Z");
const lock = { at, byName: "bot", reason: "Frozen" };
const index = new FolderIndex([
  { id: "A", parentId: null, name: "A", lock, hidden: { at, byName: "ada", reason: "Private" } },
  { id: "B", parentId: "A", name: "B", lock: null, hidden: null },
  { id: "D", parentId: null, name: "D", lock: null, hidden: null },
]);
const view = new AccessView({ mode: "all", granted: ["read"] } satisfies AccessPolicy, index);
const plain = { hiddenAt: null, hiddenByName: null, hideReason: null };

describe("hidden state", () => {
  it("is the item's own mark first, else the nearest hidden folder above", () => {
    expect(folderHiddenState(view, "A")).toEqual({
      at: at.toISOString(),
      by: "ada",
      reason: "Private",
      inherited: false,
      from: { kind: "folder", id: "A", path: "A" },
    });
    expect(folderHiddenState(view, "B")).toMatchObject({ inherited: true, from: { id: "A" } });
    expect(folderHiddenState(view, "D")).toBeNull();
    const later = { id: "n", title: "Later", folderId: "B", ...plain };
    expect(noteHiddenState(view, later)).toMatchObject({ inherited: true, from: { path: "A" } });
    const own = { ...later, folderId: "D", hiddenAt: at, hiddenByName: "eve", hideReason: null };
    expect(noteHiddenState(view, own)).toMatchObject({
      inherited: false,
      by: "eve",
      reason: null,
      from: { kind: "note", id: "n", path: "D/Later" },
    });
    expect(noteHiddenState(view, { ...later, folderId: "D" })).toBeNull();
  });
});

describe("the hidden refusal and locks", () => {
  const item = { kind: "note" as const, id: "n", path: "D/Later", title: "Later" };
  const mark = { at, byName: "ada", reason: "Private" };

  it("names the item and its mark for a read, without a lock field", () => {
    const refusal = hiddenRefusal(item, mark);
    expect(refusal).toMatchObject({ status: 403, error: "hidden" });
    expect(refusal.details).toEqual({
      hiddenItem: { kind: "note", id: "n", path: "D/Later" },
      title: "Later",
      hiddenAt: at.toISOString(),
      hiddenBy: "ada",
      reason: "Private",
    });
  });

  it("says locked: null for a write no lock refuses", () => {
    expect(hiddenRefusal(item, mark, null).details).toMatchObject({ locked: null });
  });

  it("carries the lock refusal of the same write, own or inherited", () => {
    const own = lockedRefusal(view, { kind: "note", id: "n", path: "D/Later" }, lock);
    expect(own.error).toBe("locked");
    expect(hiddenRefusal(item, mark, own).details).toMatchObject({
      reason: "Private",
      locked: { lockedItem: { kind: "note", id: "n" }, lockedBy: "bot", reason: "Frozen" },
    });
    const above = lockedRefusal(view, { kind: "folder", id: "A", path: "A" }, lock);
    const folderItem = { kind: "folder" as const, id: "B", path: "A/B" };
    expect(hiddenRefusal(folderItem, mark, above).details).toMatchObject({
      hiddenItem: folderItem,
      locked: { lockedItem: { kind: "folder", id: "A", path: "A" } },
    });
  });
});
