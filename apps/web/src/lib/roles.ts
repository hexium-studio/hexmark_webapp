import type { UserRole } from "@hexmark/shared";
import type { Messages } from "@/lib/locales/registry";

// The message key ("roles.<key>") of each role preset's label. Written out
// so that adding a role to USER_ROLES without a label fails to compile.

export type RoleLabelKey = keyof Messages["roles"];

const ROLE_LABEL_KEYS: Record<UserRole, RoleLabelKey> = {
  admin: "admin",
  user: "user",
  guest: "guest",
};

export function roleLabelKey(role: UserRole): RoleLabelKey {
  return ROLE_LABEL_KEYS[role];
}
