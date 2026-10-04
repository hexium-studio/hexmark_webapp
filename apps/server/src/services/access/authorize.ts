import type { NotePermission } from "@hexmark/shared";
import type { Transaction } from "../../db/client";
import type { Failure } from "../../lib/outcome";
import { type FolderIndex, loadFolderIndex } from "../notes/folder-index";
import { isFailure, refuse } from "../notes/refusals";
import { type Access, type AccessRef, lockAccess } from "./access";
import { AccessView } from "./access-view";
import {
  type AccessPolicy,
  concealed,
  folderPermissions,
  type HiddenFolders,
  notePermissions,
} from "./policy";

// The one place that decides what a request may do with notes and folders.
// HTTP endpoints and MCP tools reach notes only through services that call
// authorize first, inside the transaction that then reads or writes: the
// session or token row is locked there, the token's entries are read with
// it, and every item is judged by the same view (access-view.ts, policy.ts).
// An item the caller has no permission on is invisible: not found, never
// named. One it can see but lacks the permission for is forbidden.

export interface Grant {
  access: Access;
  // The folders in use and what the caller may do with each (and its notes).
  view: AccessView;
  index: FolderIndex;
  // The same over all folders, also those in the trash (loaded on demand).
  trashView(): Promise<AccessView>;
}

// `placeFirst`: the operation puts something into a place it judges itself
// (placeRefusal and the locked chain): a place out of reach answers
// outside_scope even when the permission is held nowhere - the root level of
// an allow_list token is never a place to create in, whatever it holds.
export async function authorize(
  tx: Transaction,
  ref: AccessRef,
  now: Date,
  permission: NotePermission,
  placeFirst = false,
): Promise<Grant | Failure> {
  const access = await lockAccess(tx, ref, now);
  if (isFailure(access)) return access;
  // Held nowhere: refused at once, whatever the item (unless the place
  // decides: there every item lacking the permission is refused as well).
  if (!placeFirst && !access.permissions.includes(permission)) {
    return refuse("forbidden", { permission });
  }
  const index = await loadFolderIndex(tx);
  let trash: Promise<AccessView> | undefined;
  return {
    access,
    index,
    view: new AccessView(access.policy, index),
    trashView: () => {
      trash ??= loadFolderIndex(tx, true).then((all) => new AccessView(access.policy, all));
      return trash;
    },
  };
}

// What a permission is checked on: a note (by its folder's chain), a folder
// acted on (its own chain) or a place something is put into (the chain of
// that folder; empty for the root level).
export type Checked = { kind: "note"; id: string } | { kind: "folder" } | { kind: "place" };

// The one judgement for every item: invisible (no permission at all) is
// not found - or, for a place, forbidden with reason outside_scope, so an
// agent learns why it cannot put something there (the root level of an
// allow_list token too); a place below a hidden folder is not found, like
// everything there. Visible without the permission is forbidden.
// `chain`: the folder and the folders above it, nearest first; `hidden`:
// the folders hidden themselves (policy.ts).
export function chainRefusal(
  policy: AccessPolicy,
  checked: Checked,
  chain: readonly string[],
  hidden: HiddenFolders,
  permission: NotePermission,
): Failure | null {
  const permissions =
    checked.kind === "note"
      ? notePermissions(policy, checked.id, chain, hidden)
      : folderPermissions(policy, chain, hidden);
  if (permissions.length === 0) {
    if (checked.kind === "note") return refuse("not_found");
    if (checked.kind === "folder" || concealed(policy, chain, hidden, 1)) {
      return refuse("folder_not_found");
    }
    return refuse("forbidden", { reason: "outside_scope" });
  }
  return permissions.includes(permission) ? null : refuse("forbidden", { permission });
}

// The same on the operation's folder index: what reads decide on, and the
// cheap first check of a write (lock-guard.ts decides again on the folder
// rows it locks).
export function noteRefusal(
  view: AccessView,
  note: { id: string; folderId: string | null },
  permission: NotePermission,
): Failure | null {
  return chainRefusal(
    view.policy,
    { kind: "note", id: note.id },
    view.index.chain(note.folderId),
    view.index.hidden,
    permission,
  );
}

export function folderRefusal(
  view: AccessView,
  folderId: string,
  permission: NotePermission,
): Failure | null {
  const chain = view.index.chain(folderId);
  return chainRefusal(view.policy, { kind: "folder" }, chain, view.index.hidden, permission);
}

export function placeRefusal(
  view: AccessView,
  folderId: string | null,
  permission: NotePermission,
): Failure | null {
  const chain = view.index.chain(folderId);
  return chainRefusal(view.policy, { kind: "place" }, chain, view.index.hidden, permission);
}
