import { NOTE_PERMISSIONS, type NotePermission } from "@hexmark/shared";

// What a caller may do with each note and folder, decided from its access
// policy alone - the one rule every read, search, listing and write applies
// (through access-view.ts). Pure, so it can be tested on its own.
//
// - all: a person's session; the role's permissions everywhere.
// - allow_list: only the listed targets. A folder entry covers the folder and
//   everything below it; the permissions of an item are the union of the
//   entries on it and on the folders above it. The root level itself is not
//   a target, so nothing can be created there.
// - deny_list: everything except the listed targets (and what lies below an
//   excluded folder), with the base permissions.
// Always intersected with the owner's role (`granted`): a token never
// exceeds its owner. An item with no permission is invisible.
//
// Hidden folders cut an agent's (a token's) view, whatever its mode and
// entries: everything below a hidden folder - its notes, its subfolders and
// theirs, also what is created there later - has no permission and so does
// not exist for it. The hidden folder itself stays visible with its
// permissions, as does a hidden note; that their content cannot be read and
// that agents cannot change them is decided where content is read and
// written (authorize.ts, locks/lock-guard.ts). People are not affected.

export type AccessPolicy =
  | { mode: "all"; granted: readonly NotePermission[] }
  | {
      mode: "allow_list";
      granted: readonly NotePermission[];
      folders: ReadonlyMap<string, readonly NotePermission[]>;
      notes: ReadonlyMap<string, readonly NotePermission[]>;
    }
  | {
      mode: "deny_list";
      granted: readonly NotePermission[];
      base: readonly NotePermission[];
      folders: ReadonlySet<string>;
      notes: ReadonlySet<string>;
    };

const NONE: readonly NotePermission[] = [];

// The folders hidden themselves, by id (any superset of those in a chain).
export type HiddenFolders = ReadonlySet<string>;

// An agent: a token, whatever its mode. People's sessions are "all".
export function isAgentPolicy(policy: AccessPolicy): boolean {
  return policy.mode !== "all";
}

// Whether a hidden folder in the chain hides it from an agent, starting at
// `from`: 0 the folder itself (what lies in it), 1 the folders above it
// (the folder as such).
export function concealed(
  policy: AccessPolicy,
  chain: readonly string[],
  hidden: HiddenFolders,
  from: 0 | 1,
): boolean {
  return isAgentPolicy(policy) && chain.slice(from).some((id) => hidden.has(id));
}

function within(granted: readonly NotePermission[], wanted: Iterable<NotePermission>) {
  const set = new Set(wanted);
  return NOTE_PERMISSIONS.filter(
    (permission) => set.has(permission) && granted.includes(permission),
  );
}

// A note entry's own permissions as they count for the note: a note listed
// with read can be found by search (a note entry carries no search itself).
export function noteEntryPermissions(permissions: readonly NotePermission[]): NotePermission[] {
  return permissions.includes("read") ? [...permissions, "search"] : [...permissions];
}

// `chain`: the folder and the folders above it, nearest first; empty for the
// root level.
export function folderPermissions(
  policy: AccessPolicy,
  chain: readonly string[],
  hidden: HiddenFolders,
): readonly NotePermission[] {
  if (concealed(policy, chain, hidden, 1)) return NONE;
  switch (policy.mode) {
    case "all":
      return within(policy.granted, policy.granted);
    case "allow_list":
      return within(
        policy.granted,
        chain.flatMap((id) => policy.folders.get(id) ?? NONE),
      );
    case "deny_list":
      return chain.some((id) => policy.folders.has(id))
        ? NONE
        : within(policy.granted, policy.base);
  }
}

// What lies directly in the folder whose chain is given (empty: the root
// level), unless a note entry adds to it: nothing for an agent when that
// folder or one above it is hidden.
export function contentPermissions(
  policy: AccessPolicy,
  chain: readonly string[],
  hidden: HiddenFolders,
): readonly NotePermission[] {
  return concealed(policy, chain, hidden, 0) ? NONE : folderPermissions(policy, chain, hidden);
}

// A note in the folder whose chain is given (empty: the root level). Below a
// hidden folder even a note entry gives an agent nothing.
export function notePermissions(
  policy: AccessPolicy,
  noteId: string,
  chain: readonly string[],
  hidden: HiddenFolders,
): readonly NotePermission[] {
  const inherited = contentPermissions(policy, chain, hidden);
  switch (policy.mode) {
    case "all":
      return inherited;
    case "allow_list": {
      const own = policy.notes.get(noteId);
      if (!own || concealed(policy, chain, hidden, 0)) return inherited;
      return within(policy.granted, [...inherited, ...noteEntryPermissions(own)]);
    }
    case "deny_list":
      return policy.notes.has(noteId) ? NONE : inherited;
  }
}

// Everything the caller holds anywhere: what get_overview reports and what
// decides whether a request is worth checking item by item.
export function heldPermissions(policy: AccessPolicy): readonly NotePermission[] {
  switch (policy.mode) {
    case "all":
      return within(policy.granted, policy.granted);
    case "allow_list":
      return within(policy.granted, [
        ...[...policy.folders.values()].flat(),
        ...[...policy.notes.values()].flatMap(noteEntryPermissions),
      ]);
    case "deny_list":
      return within(policy.granted, policy.base);
  }
}
