import { describe, expect, it } from "vitest";
import { readTokenInfo } from "@/lib/api-tokens/token-result";
import { readPickerTree, withLoadedFolder } from "@/lib/api-tokens/tree";
import { readLockedItem } from "@/lib/locks/load";
import {
  accessBody,
  accessProblems,
  expiryOf,
} from "../../../apps/web/src/app/account/tokens/_components/token-draft";

// The pure parts of a token's access on the token page and of /locked: the
// target tree (filled in when a folder is opened), the access the form
// sends and what is missing before, tokens and locked items as read.

describe("the target tree", () => {
  const body = {
    folder: null,
    notes: [{ id: "n", title: "Root note" }],
    folders: [
      {
        id: "b",
        name: "Projects",
        path: "Projects",
        loaded: true,
        notes: [{ id: "m", title: "Plan" }],
        folders: [{ id: "c", name: "Web", path: "Projects/Web", loaded: false, folderCount: 2 }],
      },
    ],
  };

  it("reads folders and notes with their paths, deeper folders not loaded yet", () => {
    expect(readPickerTree(body)).toEqual({
      notes: [{ id: "n", title: "Root note", path: "Root note" }],
      folders: [
        {
          id: "b",
          name: "Projects",
          path: "Projects",
          loaded: true,
          notes: [{ id: "m", title: "Plan", path: "Projects/Plan" }],
          folders: [
            { id: "c", name: "Web", path: "Projects/Web", loaded: false, folders: [], notes: [] },
          ],
        },
      ],
    });
    expect(readPickerTree({ folders: [{ id: 1 }] })).toBeUndefined();
    expect(readPickerTree({ folders: [], notes: [{ id: "x" }] })).toBeUndefined();
    expect(readPickerTree("nope")).toBeUndefined();
  });

  it("fills in a folder loaded later, at any depth", () => {
    const tree = readPickerTree(body);
    if (!tree) throw new Error("no tree");
    const inner = readPickerTree({
      folder: { id: "c", path: "Projects/Web" },
      folders: [],
      notes: [{ id: "d", title: "Deep" }],
    });
    if (!inner) throw new Error("no inner");
    const filled = withLoadedFolder(tree, "c", inner);
    expect(filled.folders[0]?.folders[0]).toMatchObject({
      loaded: true,
      notes: [{ id: "d", path: "Projects/Web/Deep" }],
    });
  });
});

describe("the access a token form sends", () => {
  const folder = { kind: "folder" as const, id: "f", path: "F", permissions: ["read" as const] };

  it("sends permissions per entry for an allow list, a base set for a deny list", () => {
    expect(
      accessBody({ mode: "allow_list", basePermissions: ["read"], entries: [folder] }),
    ).toEqual({
      mode: "allow_list",
      basePermissions: null,
      entries: [{ kind: "folder", id: "f", permissions: ["read"] }],
    });
    expect(accessBody({ mode: "deny_list", basePermissions: ["read"], entries: [folder] })).toEqual(
      {
        mode: "deny_list",
        basePermissions: ["read"],
        entries: [{ kind: "folder", id: "f" }],
      },
    );
  });

  it("names what is missing before sending", () => {
    expect(accessProblems({ mode: null, basePermissions: [], entries: [] })).toEqual({
      mode: "modeMissing",
    });
    expect(accessProblems({ mode: "deny_list", basePermissions: [], entries: [] })).toEqual({
      basePermissions: "permissionsMissing",
    });
    expect(accessProblems({ mode: "deny_list", basePermissions: ["read"], entries: [] })).toEqual(
      {},
    );
    expect(accessProblems({ mode: "allow_list", basePermissions: [], entries: [] })).toEqual({
      entries: "entriesMissing",
    });
    expect(
      accessProblems({
        mode: "allow_list",
        basePermissions: [],
        entries: [{ ...folder, permissions: [] }],
      }),
    ).toEqual({ entries: "entryPermissionsMissing" });
  });

  it("keeps, clears or sets the expiry", () => {
    expect(expiryOf("keep")).toBeUndefined();
    expect(expiryOf(null)).toBeNull();
    expect(expiryOf(30, 0)).toBe(new Date(30 * 86_400_000).toISOString());
  });
});

describe("tokens and locked items as the pages read them", () => {
  it("reads a token with its mode and entries", () => {
    const info = {
      id: "t",
      name: "agent",
      prefix: "hmk_abcd",
      mode: "allow_list",
      basePermissions: null,
      entries: [
        {
          id: "e",
          kind: "note",
          targetId: "n",
          path: "A/N",
          targetTrashed: true,
          permissions: ["edit", "read", "x"],
        },
      ],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      revokedAt: null,
    };
    expect(readTokenInfo(info)?.entries).toEqual([
      {
        id: "e",
        kind: "note",
        targetId: "n",
        path: "A/N",
        targetTrashed: true,
        permissions: ["read", "edit"],
      },
    ]);
    expect(readTokenInfo({ ...info, mode: "whole" })).toBeUndefined();
    expect(readTokenInfo({ ...info, entries: [{ id: "e" }] })).toBeUndefined();
  });

  it("reads a locked item", () => {
    const item = {
      kind: "folder",
      id: "f",
      path: "A",
      lockedAt: "2026-10-04T00:00:00.000Z",
      lockedBy: "bot",
      reason: null,
      coveredFolders: 1,
      coveredNotes: 2,
    };
    expect(readLockedItem(item)).toEqual(item);
    expect(readLockedItem({ ...item, kind: "page" })).toBeUndefined();
    expect(readLockedItem({ ...item, coveredNotes: "2" })).toBeUndefined();
  });
});
