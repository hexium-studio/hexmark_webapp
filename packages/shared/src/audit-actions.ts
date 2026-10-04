// The audit log's action codes: one catalogue for the server that writes
// events, the query API that filters by them (GET /api/audit/v1/actions) and
// the log UI that will offer them as a filter. docs/audit.md describes each.
//
// A code names what was done or tried. A successful action is written with
// outcome "success"; an attempt that was refused or failed is written with
// the SAME code, outcome "failure" and an error code. Only the sign-in has a
// code of its own for failures (auth.sign_in_failed), so failed sign-ins can
// be watched with one filter.

export type AuditTargetKind =
  | "note"
  | "folder"
  | "trash"
  | "user"
  | "token"
  | "security_key"
  | "settings"
  | "audit";

// Which outcomes a code is written with.
export type AuditOutcomes = "success" | "failure" | "both";

export interface AuditActionInfo {
  // What the code means, in English (the UI translates codes, not this).
  description: string;
  // What the event's target is, when it has one.
  target: AuditTargetKind | null;
  outcomes: AuditOutcomes;
}

const note = (description: string, outcomes: AuditOutcomes = "both"): AuditActionInfo => ({
  description,
  target: "note",
  outcomes,
});
const folder = (description: string, outcomes: AuditOutcomes = "both"): AuditActionInfo => ({
  description,
  target: "folder",
  outcomes,
});
const other = (
  target: AuditTargetKind | null,
  description: string,
  outcomes: AuditOutcomes = "both",
): AuditActionInfo => ({ description, target, outcomes });

export const AUDIT_ACTIONS = {
  "note.created": note("A note was created."),
  "note.updated": note("A note's title or body was changed (or a change was attempted)."),
  "note.section_replaced": note("One section of a note was replaced."),
  "note.moved": note("A note was moved to another folder."),
  "note.deleted": note("A note was moved to the trash (viaFolder: with that folder)."),
  "note.restored": note("A note came back from the trash (viaFolder: with that folder)."),
  "note.deleted_permanently": note("A note in the trash was deleted for good by a person."),
  "note.purged": note("The server deleted a note for good after the trash retention.", "success"),
  "folder.created": folder("A folder was created."),
  "folder.renamed": folder("A folder was renamed."),
  "folder.moved": folder("A folder was moved into another parent."),
  "folder.deleted": folder(
    "A folder went to the trash with everything in it, as one batch (viaFolder: a subfolder " +
      "that went with that folder).",
  ),
  "folder.restored": folder(
    "A folder came back from the trash with its batch (viaFolder: a subfolder that came " +
      "back with that folder).",
  ),
  "folder.deleted_permanently": folder("A folder in the trash was deleted for good."),
  "folder.purged": folder("The server deleted a folder for good after the retention.", "success"),
  "note.locked": note("A note was locked: agents can no longer change it (reason in reason)."),
  "note.unlocked": note("A person lifted a note's lock."),
  "folder.locked": folder(
    "A folder was locked with everything below it, also what is created there later.",
  ),
  "folder.unlocked": folder("A person lifted a folder's lock."),
  "note.hidden": note(
    "A note was hidden: agents can no longer read its content or change it (reason in reason).",
  ),
  "note.unhidden": note("A person made a hidden note visible to agents again."),
  "folder.hidden": folder(
    "A folder was hidden: everything below it, also what is created there later, no longer " +
      "exists for agents.",
  ),
  "folder.unhidden": folder("A person made a hidden folder visible to agents again."),
  "trash.emptied": other("trash", "An administrator emptied the whole trash."),
  "read.overview": other(null, "An agent read the overview (get_overview)."),
  "read.folder": other("folder", "An agent listed a folder or the root level."),
  "read.search": other(null, "An agent searched the notes."),
  "read.outline": note("An agent read a note's outline."),
  "read.section": note("An agent read one section of a note (or a piece of it)."),
  "read.note": note("An agent read a whole note."),
  "read.changes": other(null, "An agent listed the notes changed since a time."),
  "read.revisions": note("An agent listed a note's revisions."),
  "read.revision": note("An agent read one revision of a note."),
  "read.trash": other("trash", "An agent listed the trash."),
  "read.locked": other(null, "An agent listed the locked notes and folders."),
  "read.hidden": other(
    null,
    "A request to list the hidden notes and folders was refused (people only; their own " +
      "reads are not logged).",
    "failure",
  ),
  "auth.sign_in": other("user", "A person signed in; a session started.", "success"),
  "auth.sign_in_failed": other(
    "user",
    "A sign-in was refused: unknown e-mail or wrong password (invalid_credentials), or " +
      "too many attempts (rate_limited).",
    "failure",
  ),
  "auth.second_factor_verified": other(
    "user",
    "A second factor (authenticator app, security key or recovery code) was checked at sign-in.",
  ),
  "auth.sign_out": other("user", "A person signed out.", "success"),
  "auth.reauthenticated": other("user", "A person re-entered their password in a session."),
  "auth.token_rejected": other(
    "token",
    "A request came with an API token that is unknown, revoked or expired (logged once per " +
      "token value in 10 minutes; suppressed: how many were left out before).",
    "failure",
  ),
  "two_factor.totp_added": other("user", "An authenticator app was added as a second factor."),
  "two_factor.totp_removed": other("user", "The authenticator app was removed."),
  "two_factor.security_key_added": other("security_key", "A security key or passkey was added."),
  "two_factor.security_key_renamed": other("security_key", "A security key was renamed."),
  "two_factor.security_key_removed": other("security_key", "A security key was removed."),
  "two_factor.recovery_codes_regenerated": other("user", "A new set of recovery codes was made."),
  "token.created": other("token", "An API token was created (the token itself is never logged)."),
  "token.revoked": other("token", "An API token was revoked."),
  "token.updated": other(
    "token",
    "An API token's access mode, entries, base permissions or expiry were changed (before " +
      "and after in details).",
  ),
  "token.entry_removed": other(
    "token",
    "The server removed an entry of an API token because its target was deleted for good.",
    "success",
  ),
  "setup.admin_created": other("user", "The setup wizard created the first administrator."),
  "settings.changed": other("settings", "System settings were changed (old and new values)."),
  "audit.read": other(
    "audit",
    "A request to read the audit log was refused (agents cannot read it; invalid filters).",
    "failure",
  ),
  "audit.purged": other(
    "audit",
    "The server deleted audit events older than the retention (count in details).",
    "success",
  ),
} as const satisfies Record<string, AuditActionInfo>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_CODES = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(AUDIT_ACTIONS, value);
}

// How many days audit events are kept (AUDIT_RETENTION_DAYS,
// apps/server/src/config/audit.ts).
export const AUDIT_RETENTION_DAYS = { default: 365, min: 1, max: 3650 } as const;
