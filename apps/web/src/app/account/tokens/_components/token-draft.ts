import type {
  ApiTokenAccessMode,
  ApiTokenInfo,
  NotePermission,
  TokenEntryKind,
} from "@hexmark/shared";

// What the token form sends (token-actions.ts): the name (new tokens), the
// access - mode, base permissions (deny_list) and targets (each with its
// permissions on an allow_list) - and the expiry.

// Offered expiry periods; null: never expires.
export const EXPIRY_DAYS = [30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number] | null;
// Changing a token: "keep" leaves its expiry as it is.
export type ExpiryChoice = ExpiryDays | "keep";

export interface DraftEntry {
  kind: TokenEntryKind;
  id: string;
  path: string;
  permissions: NotePermission[];
  // A target in the trash, kept from before (shown, not offered anew).
  trashed?: boolean;
}

export interface AccessDraft {
  // null until chosen: there is no default.
  mode: ApiTokenAccessMode | null;
  basePermissions: NotePermission[];
  entries: DraftEntry[];
}

export interface TokenDraft {
  name: string;
  access: AccessDraft;
  expiry: ExpiryChoice;
}

// The access as the token API takes it.
export function accessBody(access: AccessDraft) {
  const allow = access.mode === "allow_list";
  return {
    mode: access.mode,
    basePermissions: allow ? null : access.basePermissions,
    entries: access.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      ...(allow ? { permissions: entry.permissions } : {}),
    })),
  };
}

export function draftOf(token: ApiTokenInfo): AccessDraft {
  return {
    mode: token.mode,
    basePermissions: token.basePermissions ?? [],
    entries: token.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.targetId,
      path: entry.path,
      permissions: entry.permissions ?? [],
      trashed: entry.targetTrashed,
    })),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ISO time for the API; undefined: keep the current expiry.
export function expiryOf(choice: ExpiryChoice, now = Date.now()): string | null | undefined {
  if (choice === "keep") return undefined;
  const days = EXPIRY_DAYS.find((value) => value === choice);
  return days ? new Date(now + days * DAY_MS).toISOString() : null;
}

// What is missing before the form can be sent, as message keys of
// "tokens.form.access" (the server checks the same rules again).
export interface AccessProblems {
  mode?: "modeMissing";
  basePermissions?: "permissionsMissing";
  entries?: "entriesMissing" | "entryPermissionsMissing";
}

export function accessProblems(access: AccessDraft): AccessProblems {
  if (access.mode === null) return { mode: "modeMissing" };
  if (access.mode === "deny_list") {
    return access.basePermissions.length === 0 ? { basePermissions: "permissionsMissing" } : {};
  }
  if (access.entries.length === 0) return { entries: "entriesMissing" };
  if (access.entries.some((entry) => entry.permissions.length === 0)) {
    return { entries: "entryPermissionsMissing" };
  }
  return {};
}
