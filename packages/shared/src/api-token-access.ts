import { z } from "zod";
import { type FieldErrorCode, type FieldErrors, requiredOr } from "./field-errors";
import { idSchema, NOTE_PERMISSIONS, type NotePermission } from "./notes";

// What an API token can reach: its access mode and its list of targets
// (folders with everything below them, or single notes), shared by the
// server (which enforces it, also as database checks) and the web app.
//
// - allow_list: only the listed targets, each entry with its own
//   permissions. Nothing at the root level unless a listed target lies there;
//   creating at the root level is not possible.
// - deny_list: the whole wiki except the listed targets, with one set of
//   permissions (basePermissions) for everything it can reach. An empty list
//   is the whole wiki.

export const API_TOKEN_ACCESS_MODES = ["allow_list", "deny_list"] as const;
export type ApiTokenAccessMode = (typeof API_TOKEN_ACCESS_MODES)[number];

export const TOKEN_ENTRY_KINDS = ["folder", "note"] as const;
export type TokenEntryKind = (typeof TOKEN_ENTRY_KINDS)[number];

// A folder entry can carry every permission. A note entry cannot carry
// create (nothing is created inside a note) or search: a note listed with
// read is found by search like any other note the token may search.
export const FOLDER_ENTRY_PERMISSIONS: readonly NotePermission[] = NOTE_PERMISSIONS;
export const NOTE_ENTRY_PERMISSIONS: readonly NotePermission[] = NOTE_PERMISSIONS.filter(
  (permission) => permission !== "create" && permission !== "search",
);

export function entryPermissionsOf(kind: TokenEntryKind): readonly NotePermission[] {
  return kind === "folder" ? FOLDER_ENTRY_PERMISSIONS : NOTE_ENTRY_PERMISSIONS;
}

// Most entries one token can list.
export const API_TOKEN_ENTRIES_MAX = 200;

const code = (value: FieldErrorCode) => value;

export const notePermissionSchema = z.enum(NOTE_PERMISSIONS, { error: code("invalid_option") });

// At least one, each once, in the order of NOTE_PERMISSIONS.
export const permissionSetSchema = z
  .array(notePermissionSchema, { error: requiredOr("invalid_type") })
  .min(1, code("required"))
  .transform((list) => NOTE_PERMISSIONS.filter((permission) => list.includes(permission)));

export const accessModeSchema = z.enum(API_TOKEN_ACCESS_MODES, {
  error: requiredOr("invalid_option"),
});

// One target. `permissions` belongs to allow_list entries only; which mode
// applies is decided with the token (tokenAccessProblems).
export const tokenEntryInputSchema = z.object(
  {
    kind: z.enum(TOKEN_ENTRY_KINDS, { error: requiredOr("invalid_option") }),
    id: idSchema,
    permissions: permissionSetSchema.optional(),
  },
  { error: code("invalid_type") },
);
export type TokenEntryInput = z.infer<typeof tokenEntryInputSchema>;

export const tokenEntriesSchema = z
  .array(tokenEntryInputSchema, { error: requiredOr("invalid_type") })
  .max(API_TOKEN_ENTRIES_MAX, code("too_long"));

// The rules that depend on the mode, for a token as it would be after
// creating or changing it. Null when it is consistent; otherwise the field
// errors (`params.index`: the entry at fault).
export function tokenAccessProblems(
  mode: ApiTokenAccessMode,
  basePermissions: readonly NotePermission[] | null | undefined,
  entries: readonly TokenEntryInput[],
): FieldErrors | null {
  const fields: FieldErrors = {};
  if (mode === "deny_list" && !basePermissions) fields.basePermissions = { code: "required" };
  if (mode === "allow_list" && basePermissions) fields.basePermissions = { code: "invalid" };
  if (mode === "allow_list" && entries.length === 0) fields.entries = { code: "required" };
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (fields.entries) return;
    const key = `${entry.kind}:${entry.id.toLowerCase()}`;
    const params = { index };
    if (seen.has(key)) fields.entries = { code: "invalid", params };
    else if (mode === "deny_list" && entry.permissions)
      fields.entries = { code: "invalid", params };
    else if (mode === "allow_list" && !entry.permissions) {
      fields.entries = { code: "required", params };
    } else if (
      entry.permissions?.some((permission) => !entryPermissionsOf(entry.kind).includes(permission))
    ) {
      fields.entries = { code: "invalid_option", params };
    }
    seen.add(key);
  });
  return Object.keys(fields).length > 0 ? fields : null;
}

// One entry of a token as GET /api/tokens/v1/tokens lists it. `path` is the
// target's path now (where it was, for a target in the trash); an entry
// never outlives its target (deleting the target for good removes it).
export interface ApiTokenEntryInfo {
  id: string;
  kind: TokenEntryKind;
  targetId: string;
  path: string;
  // The target is in the trash: the entry stays and applies again on restore.
  targetTrashed: boolean;
  // allow_list only; null for deny_list.
  permissions: NotePermission[] | null;
}
