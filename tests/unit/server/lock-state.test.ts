import { describe, expect, it } from "vitest";
import { AccessView } from "../../../apps/server/src/services/access/access-view";
import type { AccessPolicy } from "../../../apps/server/src/services/access/policy";
import { folderLockState, noteLockState } from "../../../apps/server/src/services/locks/lock-state";
import { FolderIndex } from "../../../apps/server/src/services/notes/folder-index";

// The lock an item is under (lock-state.ts): its own, else the nearest
// locked folder above it - also for what is created below a locked folder
// later, as nothing is copied down.

const at = new Date("2026-10-04T10:00:00.000Z");
const index = new FolderIndex([
  {
    id: "A",
    parentId: null,
    name: "A",
    lock: { at, byName: "ada", reason: "Final" },
    hidden: null,
  },
  { id: "B", parentId: "A", name: "B", lock: null, hidden: null },
  { id: "C", parentId: "B", name: "C", lock: { at, byName: "bot", reason: null }, hidden: null },
  { id: "D", parentId: null, name: "D", lock: null, hidden: null },
]);
const all: AccessPolicy = { mode: "all", granted: ["read"] };
const onlyB: AccessPolicy = {
  mode: "allow_list",
  granted: ["read"],
  folders: new Map([["B", ["read"]]]),
  notes: new Map(),
};
const unlocked = { lockedAt: null, lockedByName: null, lockReason: null };

describe("lock state", () => {
  it("is the item's own lock first, else the nearest locked folder above", () => {
    const view = new AccessView(all, index);
    expect(folderLockState(view, "A")).toEqual({
      at: at.toISOString(),
      by: "ada",
      reason: "Final",
      inherited: false,
      from: { kind: "folder", id: "A", path: "A" },
    });
    expect(folderLockState(view, "B")).toMatchObject({ inherited: true, from: { id: "A" } });
    expect(folderLockState(view, "C")).toMatchObject({ inherited: false, by: "bot" });
    expect(folderLockState(view, "D")).toBeNull();
    const note = { id: "n", title: "Later", folderId: "B", ...unlocked };
    expect(noteLockState(view, note)).toMatchObject({
      inherited: true,
      from: { kind: "folder", id: "A", path: "A" },
    });
    const own = { ...note, folderId: "D", lockedAt: at, lockedByName: "eve", lockReason: "x" };
    expect(noteLockState(view, own)).toMatchObject({
      inherited: false,
      by: "eve",
      from: { kind: "note", id: "n", path: "D/Later" },
    });
    expect(noteLockState(view, { ...note, folderId: "D" })).toBeNull();
  });

  it("does not name the id of a locking folder the caller cannot see", () => {
    const view = new AccessView(onlyB, index);
    expect(folderLockState(view, "B")).toMatchObject({
      inherited: true,
      from: { kind: "folder", id: null, path: "A" },
    });
  });
});
