import {
  entryPermissionsOf,
  type NotePermission,
  ROLE_PERMISSIONS,
  type TokenEntryKind,
  type UserRole,
} from "@hexmark/shared";

// The permissions the token form offers: what the role grants (the same
// rule the server enforces, from @hexmark/shared); for an entry of an allow
// list also only what its kind of target can carry (a single note: no
// create or search). `delete` lets an agent move notes and folders to the
// trash and restore them, never delete for good; `lock` lets it lock
// (only people unlock). A new entry starts with read and search, as far as
// they are offered.

export const DEFAULT_PERMISSIONS: readonly NotePermission[] = ["read", "search"];

export function offeredPermissions(role: UserRole, kind?: TokenEntryKind): NotePermission[] {
  const granted = ROLE_PERMISSIONS[role];
  const carried = kind ? entryPermissionsOf(kind) : granted;
  return granted.filter((permission) => carried.includes(permission));
}

export function defaultPermissions(role: UserRole, kind?: TokenEntryKind): NotePermission[] {
  return offeredPermissions(role, kind).filter((permission) =>
    DEFAULT_PERMISSIONS.includes(permission),
  );
}
