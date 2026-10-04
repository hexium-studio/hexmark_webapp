import { type NotePermission, ROLE_PERMISSIONS, type UserRole } from "@hexmark/shared";

// The permissions the create form offers: what the role grants (the same
// rule the server enforces, from @hexmark/shared), without `lock`: no MCP
// tool uses it yet (locking comes in a later version, docs/mcp.md), and a
// box that changes nothing for an agent is not offered. The server still
// accepts it. `delete` is offered: it lets an agent move notes and folders
// to the trash and restore them, never delete for good. Read and search are
// checked by default.

export const DEFAULT_PERMISSIONS: readonly NotePermission[] = ["read", "search"];

const NOT_OFFERED: readonly NotePermission[] = ["lock"];

export function offeredPermissions(role: UserRole): NotePermission[] {
  return ROLE_PERMISSIONS[role].filter((permission) => !NOT_OFFERED.includes(permission));
}

export function defaultPermissions(role: UserRole): NotePermission[] {
  return offeredPermissions(role).filter((permission) => DEFAULT_PERMISSIONS.includes(permission));
}
