import {
  NOTE_PERMISSIONS,
  type NotePermission,
  ROLE_PERMISSIONS,
  type UserRole,
} from "@hexmark/shared";

// What a role grants comes from @hexmark/shared (ROLE_PERMISSIONS), so the
// web app offers exactly what is enforced here. Pure, so it can be tested on
// its own.

// What a request may do: the owner's role, and for an agent also the token's
// own permissions. A token never exceeds its owner.
export function effectivePermissions(
  role: UserRole,
  tokenPermissions: readonly NotePermission[] | null,
): NotePermission[] {
  const granted = ROLE_PERMISSIONS[role];
  return NOTE_PERMISSIONS.filter(
    (permission) =>
      granted.includes(permission) &&
      (tokenPermissions === null || tokenPermissions.includes(permission)),
  );
}

// Permissions asked for that the role does not grant (for refusing a token
// that could never use them).
export function beyondRole(role: UserRole, wanted: readonly NotePermission[]): NotePermission[] {
  return wanted.filter((permission) => !ROLE_PERMISSIONS[role].includes(permission));
}
