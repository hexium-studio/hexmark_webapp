import type { UserRole } from "./auth";
import { NOTE_PERMISSIONS, type NotePermission } from "./notes";

// Which note permissions a role grants (docs/design/notes-and-agents.md,
// section 3). Fine-grained permissions per human follow in a later milestone;
// until then the role decides. The server enforces it (a token never exceeds
// its owner); the web app offers only these when a token is created.
export const ROLE_PERMISSIONS: Record<UserRole, readonly NotePermission[]> = {
  admin: NOTE_PERMISSIONS,
  user: NOTE_PERMISSIONS,
  guest: ["read", "search"],
};
