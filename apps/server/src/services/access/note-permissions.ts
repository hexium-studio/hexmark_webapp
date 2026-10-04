import { type NotePermission, ROLE_PERMISSIONS, type UserRole } from "@hexmark/shared";

// What a role grants comes from @hexmark/shared (ROLE_PERMISSIONS), so the
// web app offers exactly what is enforced. Pure, so it can be tested on its
// own. How a token's permissions combine with the role: policy.ts.

// Permissions asked for that the role does not grant (for refusing a token
// that could never use them).
export function beyondRole(role: UserRole, wanted: readonly NotePermission[]): NotePermission[] {
  return wanted.filter((permission) => !ROLE_PERMISSIONS[role].includes(permission));
}
