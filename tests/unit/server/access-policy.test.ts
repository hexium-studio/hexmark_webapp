import { NOTE_PERMISSIONS, type NotePermission, ROLE_PERMISSIONS } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { AccessView } from "../../../apps/server/src/services/access/access-view";
import {
  type AccessPolicy,
  folderPermissions,
  heldPermissions,
  notePermissions,
} from "../../../apps/server/src/services/access/policy";
import { FolderIndex } from "../../../apps/server/src/services/notes/folder-index";

// The access evaluation (services/access/policy.ts, access-view.ts): what a
// session, an allow_list and a deny_list token may do with each folder and
// note, nested at any depth, always within the owner's role.
//
// Tree: A > B > C, and D, all from the root level. Notes: n1 in C, n2 at the
// root level, n3 in D.

const index = new FolderIndex([
  { id: "A", parentId: null, name: "A", lock: null, hidden: null },
  { id: "B", parentId: "A", name: "B", lock: null, hidden: null },
  { id: "C", parentId: "B", name: "C", lock: null, hidden: null },
  { id: "D", parentId: null, name: "D", lock: null, hidden: null },
]);
const NOTES = { n1: "C", n2: null, n3: "D" } as const;

const ALL = [...NOTE_PERMISSIONS];
const role = (name: "admin" | "user" | "guest") => ROLE_PERMISSIONS[name];

function allow(
  folders: Record<string, NotePermission[]>,
  notes: Record<string, NotePermission[]> = {},
  granted = role("user"),
): AccessPolicy {
  return {
    mode: "allow_list",
    granted,
    folders: new Map(Object.entries(folders)),
    notes: new Map(Object.entries(notes)),
  };
}

function deny(
  base: NotePermission[],
  folders: string[] = [],
  notes: string[] = [],
  granted = role("user"),
): AccessPolicy {
  return { mode: "deny_list", granted, base, folders: new Set(folders), notes: new Set(notes) };
}

// Permissions per folder (and "" for the root level) and per note.
function table(policy: AccessPolicy) {
  const view = new AccessView(policy, index);
  const folders = Object.fromEntries(
    ["", "A", "B", "C", "D"].map((id) => [id, [...view.folder(id === "" ? null : id)]]),
  );
  const notes = Object.fromEntries(
    Object.entries(NOTES).map(([id, folder]) => [id, [...view.note(id, folder)]]),
  );
  return { folders, notes };
}

describe("a person's session", () => {
  it("has the role's permissions everywhere", () => {
    const user = table({ mode: "all", granted: role("user") });
    expect(Object.values(user.folders)).toEqual(Array(5).fill(ALL));
    expect(Object.values(user.notes)).toEqual(Array(3).fill(ALL));
    const guest = table({ mode: "all", granted: role("guest") });
    expect(guest.folders.C).toEqual(["read", "search"]);
    expect(guest.notes.n2).toEqual(["read", "search"]);
  });
});

describe("allow_list", () => {
  it("reaches a listed folder and everything below it, nothing else", () => {
    const { folders, notes } = table(allow({ A: ["edit", "read"] }));
    expect(folders).toEqual({
      "": [],
      A: ["read", "edit"],
      B: ["read", "edit"],
      C: ["read", "edit"],
      D: [],
    });
    expect(notes).toEqual({ n1: ["read", "edit"], n2: [], n3: [] });
  });

  it("unites the entries on a folder and on the folders above it", () => {
    const { folders, notes } = table(allow({ A: ["read"], B: ["move"], C: ["delete"] }));
    expect(folders.A).toEqual(["read"]);
    expect(folders.B).toEqual(["read", "move"]);
    expect(folders.C).toEqual(["read", "move", "delete"]);
    expect(notes.n1).toEqual(["read", "move", "delete"]);
  });

  it("starts at any depth: a deep folder without the ones above it", () => {
    const { folders, notes } = table(allow({ C: ["read", "create"] }));
    expect(folders).toMatchObject({ "": [], A: [], B: [], C: ["read", "create"] });
    expect(notes.n1).toEqual(["read", "create"]);
  });

  it("reaches a single note, not its folder; a note listed with read is found by search", () => {
    const { folders, notes } = table(allow({}, { n3: ["read", "edit"] }));
    expect(folders.D).toEqual([]);
    expect(notes).toEqual({ n1: [], n2: [], n3: ["read", "search", "edit"] });
    // Without read it is not found by search either.
    expect(table(allow({}, { n3: ["lock"] })).notes.n3).toEqual(["lock"]);
  });

  it("unites a note's own entry with its folders' entries", () => {
    const { notes } = table(allow({ B: ["read"] }, { n1: ["lock"] }));
    expect(notes.n1).toEqual(["read", "lock"]);
  });

  it("never exceeds the owner's role", () => {
    const { folders, notes } = table(
      allow({ A: ["read", "edit", "search"] }, { n3: ["read", "move"] }, role("guest")),
    );
    expect(folders.C).toEqual(["read", "search"]);
    expect(notes.n3).toEqual(["read", "search"]);
  });

  it("holds the union of all entries", () => {
    expect(heldPermissions(allow({ A: ["read"], D: ["create"] }, { n2: ["lock"] }))).toEqual([
      "read",
      "create",
      "lock",
    ]);
    expect(heldPermissions(allow({}, { n2: ["read"] }))).toEqual(["read", "search"]);
    expect(heldPermissions(allow({ A: ["edit"] }, {}, role("guest")))).toEqual([]);
  });
});

describe("deny_list", () => {
  it("reaches the whole wiki with the base set when nothing is listed", () => {
    const { folders, notes } = table(deny(["read", "create"]));
    expect(Object.values(folders)).toEqual(Array(5).fill(["read", "create"]));
    expect(Object.values(notes)).toEqual(Array(3).fill(["read", "create"]));
  });

  it("hides an excluded folder with everything below it, at any depth", () => {
    const { folders, notes } = table(deny(["read"], ["B"]));
    expect(folders).toEqual({ "": ["read"], A: ["read"], B: [], C: [], D: ["read"] });
    expect(notes).toEqual({ n1: [], n2: ["read"], n3: ["read"] });
    expect(table(deny(["read"], ["C"])).folders).toMatchObject({ B: ["read"], C: [] });
  });

  it("hides an excluded note but not its folder", () => {
    const { folders, notes } = table(deny(["read", "edit"], [], ["n3"]));
    expect(folders.D).toEqual(["read", "edit"]);
    expect(notes.n3).toEqual([]);
  });

  it("never exceeds the owner's role", () => {
    const policy = deny(["read", "edit", "search"], [], [], role("guest"));
    expect(table(policy).notes.n2).toEqual(["read", "search"]);
    expect(heldPermissions(policy)).toEqual(["read", "search"]);
  });
});

describe("the pure rules", () => {
  it("take the chain nearest first and the root level as an empty chain", () => {
    const policy = allow({ B: ["read"] });
    const none = new Set<string>();
    expect(folderPermissions(policy, ["C", "B", "A"], none)).toEqual(["read"]);
    expect(folderPermissions(policy, [], none)).toEqual([]);
    expect(notePermissions(deny(["read"], ["A"]), "x", ["C", "B", "A"], none)).toEqual([]);
    expect(notePermissions(deny(["read"]), "x", [], none)).toEqual(["read"]);
  });

  it("list the folders granting a permission (null: every folder)", () => {
    expect(new AccessView({ mode: "all", granted: ALL }, index).folderIds()).toBeNull();
    expect(new AccessView(allow({ B: ["read"] }), index).folderIds("read")?.sort()).toEqual([
      "B",
      "C",
    ]);
    expect(new AccessView(deny(["read"], ["A"]), index).folderIds()).toEqual(["D"]);
    expect(new AccessView(deny(["read"]), index).folderIds("edit")).toEqual([]);
  });
});
