import { NOTE_PERMISSIONS, type NotePermission, ROLE_PERMISSIONS } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { AccessView } from "../../../apps/server/src/services/access/access-view";
import { chainRefusal } from "../../../apps/server/src/services/access/authorize";
import type { AccessPolicy } from "../../../apps/server/src/services/access/policy";
import { FolderIndex } from "../../../apps/server/src/services/notes/folder-index";

// Hidden folders in the one access evaluation (policy.ts, access-view.ts,
// authorize.ts): for an agent (allow_list or deny_list) everything below a
// hidden folder has no permission - whatever its entries say - while the
// hidden folder itself keeps its permissions; people are not affected.
// Matrix: the caller (session, allow_list, deny_list) x where an item lies
// (not hidden, the hidden folder itself, directly in it, deeper) x entries
// on it (allowing, excluding).
//
// Tree: A > H (hidden) > I > J, and A > V. Notes: inH in H, inJ in J, inV
// in V, atRoot at the root level.

const at = new Date("2026-10-04T10:00:00.000Z");
const mark = { at, byName: "ada", reason: "Private" };
const folder = (id: string, parentId: string | null, hidden = false) => ({
  id,
  parentId,
  name: id,
  lock: null,
  hidden: hidden ? mark : null,
});
const index = new FolderIndex([
  folder("A", null),
  folder("H", "A", true),
  folder("I", "H"),
  folder("J", "I"),
  folder("V", "A"),
]);
const NOTES = { inH: "H", inJ: "J", inV: "V", atRoot: null } as const;
const ALL = [...NOTE_PERMISSIONS];
const user = ROLE_PERMISSIONS.user;

const session: AccessPolicy = { mode: "all", granted: user };
const allow = (
  folders: Record<string, NotePermission[]>,
  notes: Record<string, NotePermission[]> = {},
): AccessPolicy => ({
  mode: "allow_list",
  granted: user,
  folders: new Map(Object.entries(folders)),
  notes: new Map(Object.entries(notes)),
});
const deny = (base: NotePermission[], folders: string[] = []): AccessPolicy => ({
  mode: "deny_list",
  granted: user,
  base,
  folders: new Set(folders),
  notes: new Set(),
});

// Whether each folder and note is visible at all (any permission).
function visible(policy: AccessPolicy) {
  const view = new AccessView(policy, index);
  const folders = Object.fromEntries(
    ["A", "H", "I", "J", "V"].map((id) => [id, view.seesFolder(id)]),
  );
  const notes = Object.fromEntries(
    Object.entries(NOTES).map(([id, folderId]) => [id, view.seesNote({ id, folderId })]),
  );
  return { folders, notes };
}

describe("visibility with a hidden folder", () => {
  it("is unchanged for a person", () => {
    const { folders, notes } = visible(session);
    expect(Object.values(folders).every(Boolean)).toBe(true);
    expect(Object.values(notes).every(Boolean)).toBe(true);
    expect(new AccessView(session, index).folder("J")).toEqual(ALL);
  });

  it("keeps the hidden folder and cuts everything below it for a deny_list agent", () => {
    expect(visible(deny(["read", "edit"]))).toEqual({
      folders: { A: true, H: true, I: false, J: false, V: true },
      notes: { inH: false, inJ: false, inV: true, atRoot: true },
    });
    // An exclusion elsewhere still counts; one on the hidden folder hides it too.
    expect(visible(deny(["read"], ["V"])).folders).toMatchObject({ H: true, V: false });
    expect(visible(deny(["read"], ["H"])).folders).toMatchObject({ A: true, H: false });
  });

  it("cuts below the hidden folder even where an allow_list names it", () => {
    const listed = allow({ A: ["read"], I: ["read", "edit"] }, { inJ: ["read"], inV: ["edit"] });
    expect(visible(listed)).toEqual({
      folders: { A: true, H: true, I: false, J: false, V: true },
      notes: { inH: false, inJ: false, inV: true, atRoot: false },
    });
    const view = new AccessView(listed, index);
    expect(view.folder("H")).toEqual(["read"]);
    expect(view.note("inV", "V")).toEqual(["read", "edit"]);
    expect(view.note("inJ", "J")).toEqual([]);
  });

  it("names the folders whose contents an agent cannot see", () => {
    expect(new AccessView(deny(["read"]), index).concealedIds().sort()).toEqual(["H", "I", "J"]);
    expect(new AccessView(session, index).concealedIds()).toEqual([]);
  });
});

describe("refusals with a hidden folder (chainRefusal)", () => {
  const agent = deny(["read", "create", "edit", "hide"]);
  const hidden = index.hidden;

  it("does not find what lies below it, by note, folder or place", () => {
    const noteRefusal = chainRefusal(
      agent,
      { kind: "note", id: "x" },
      ["J", "I", "H", "A"],
      hidden,
      "read",
    );
    expect(noteRefusal).toMatchObject({ status: 404, error: "not_found" });
    const inH = chainRefusal(agent, { kind: "note", id: "inH" }, ["H", "A"], hidden, "read");
    expect(inH).toMatchObject({ error: "not_found" });
    expect(chainRefusal(agent, { kind: "folder" }, ["I", "H", "A"], hidden, "edit")).toMatchObject({
      error: "folder_not_found",
    });
    // A place below it is not found either (not forbidden/outside_scope).
    expect(chainRefusal(agent, { kind: "place" }, ["I", "H", "A"], hidden, "create")).toMatchObject(
      {
        status: 404,
        error: "folder_not_found",
      },
    );
  });

  it("leaves the hidden folder itself to the hidden mark (the write guard)", () => {
    expect(chainRefusal(agent, { kind: "folder" }, ["H", "A"], hidden, "edit")).toBeNull();
    expect(chainRefusal(agent, { kind: "place" }, ["H", "A"], hidden, "create")).toBeNull();
    expect(chainRefusal(agent, { kind: "folder" }, ["H", "A"], hidden, "move")).toMatchObject({
      error: "forbidden",
      details: { permission: "move" },
    });
  });

  it("judges by the hidden set it is given: the rows a write locked", () => {
    const none = new Set<string>();
    expect(
      chainRefusal(agent, { kind: "note", id: "x" }, ["J", "I", "H"], none, "edit"),
    ).toBeNull();
    const nowHidden = new Set(["V"]);
    expect(
      chainRefusal(agent, { kind: "note", id: "inV" }, ["V", "A"], nowHidden, "edit"),
    ).toMatchObject({
      error: "not_found",
    });
    expect(
      chainRefusal(session, { kind: "note", id: "inV" }, ["V", "A"], nowHidden, "edit"),
    ).toBeNull();
  });

  it("keeps outside_scope for a place an allow_list does not reach outside hidden folders", () => {
    const listed = allow({ V: ["create"] });
    expect(chainRefusal(listed, { kind: "place" }, [], hidden, "create")).toMatchObject({
      status: 403,
      details: { reason: "outside_scope" },
    });
  });
});
